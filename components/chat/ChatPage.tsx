'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import { Send, Image as ImageIcon, X, CheckCheck, ArrowLeft } from 'lucide-react'

type ChatMessage = {
  id: string
  user_id: string
  user_name?: string
  message_type: 'text' | 'image'
  content: string | null
  image_url: string | null
  created_at: string
}

type GroupedMessages = {
  date: string
  messages: ChatMessage[]
}

function formatMessageText(text: string) {
  const parts = text.split(/(\*[^*]+\*|_[^_]+_|~[^~]+~|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('*') && part.endsWith('*'))
      return <strong key={i}>{part.slice(1, -1)}</strong>
    if (part.startsWith('_') && part.endsWith('_'))
      return <em key={i}>{part.slice(1, -1)}</em>
    if (part.startsWith('~') && part.endsWith('~'))
      return <s key={i}>{part.slice(1, -1)}</s>
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="bg-black/10 rounded px-1 font-mono text-xs">{part.slice(1, -1)}</code>
    return <span key={i}>{part}</span>
  })
}

function groupMessagesByDate(messages: ChatMessage[]): GroupedMessages[] {
  const groups: Record<string, ChatMessage[]> = {}
  messages.forEach(msg => {
    const date = new Date(msg.created_at).toLocaleDateString('en-NG', {
      year: 'numeric', month: 'long', day: 'numeric'
    })
    if (!groups[date]) groups[date] = []
    groups[date].push(msg)
  })
  return Object.entries(groups).map(([date, messages]) => ({ date, messages }))
}

export default function ChatPage() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<any>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [usersCache, setUsersCache] = useState<Record<string, string>>({})
  const [keyboardVisible, setKeyboardVisible] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const usersCacheRef = useRef<Record<string, string>>({})
  const channelRef = useRef<any>(null)
  const subscriptionSetupDone = useRef<boolean>(false)

  const scrollToBottom = useCallback((smooth = true) => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' })
    }, 50)
  }, [])

  // Detect keyboard visibility on mobile
  useEffect(() => {
    const handleResize = () => {
      const isKeyboardOpen = window.innerHeight < (window.screen.height * 0.75)
      setKeyboardVisible(isKeyboardOpen)
      if (isKeyboardOpen) {
        setTimeout(scrollToBottom, 100)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [scrollToBottom])

  const getUserName = useCallback(async (userId: string) => {
    if (usersCacheRef.current[userId]) return usersCacheRef.current[userId]
    const { data } = await supabase
      .from('users')
      .select('first_name, surname')
      .eq('id', userId)
      .single()
    if (data) {
      const name = `${data.first_name} ${data.surname}`
      usersCacheRef.current[userId] = name
      setUsersCache(prev => ({ ...prev, [userId]: name }))
      return name
    }
    return 'Unknown'
  }, [])

  useEffect(() => {
    const userSession = getSession()
    if (!userSession) {
      router.replace('/auth/login')
      return
    }
    setSession(userSession)
  }, [router])

  useEffect(() => {
    if (!session) return
    fetchMessages()
  }, [session])

  // Set up realtime subscription
  useEffect(() => {
    if (!session) return

    // Prevent duplicate setup
    if (subscriptionSetupDone.current) {
      console.log('Chat subscription already set up, skipping')
      return
    }

    const setupChannel = () => {
      // Clean up existing channel if any
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
        subscriptionSetupDone.current = false
      }

      const channel = supabase.channel(`kitchen-chat-${Date.now()}`)

      channel
        .on(
          'postgres_changes' as any,
          { event: 'INSERT', schema: 'public', table: 'chat_messages' },
          async (payload: any) => {
            const name = await getUserName(payload.new.user_id)
            const newMsg: ChatMessage = {
              id: payload.new.id,
              user_id: payload.new.user_id,
              message_type: payload.new.message_type,
              content: payload.new.content,
              image_url: payload.new.image_url,
              created_at: payload.new.created_at,
              user_name: name,
            }
            setMessages(prev => {
              if (prev.find(m => m.id === newMsg.id)) return prev
              return [...prev, newMsg]
            })
            scrollToBottom()
          }
        )
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            console.log('✅ Subscribed to chat updates')
            subscriptionSetupDone.current = true
          } else if (status === 'CHANNEL_ERROR') {
            console.error('❌ Chat channel error, will retry in 5 seconds')
            subscriptionSetupDone.current = false
            supabase.removeChannel(channel)
            setTimeout(setupChannel, 5000)
          }
        })

      channelRef.current = channel
    }

    setupChannel()

    return () => {
      if (channelRef.current) {
        console.log('Cleaning up chat subscription')
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
        subscriptionSetupDone.current = false
      }
    }
  }, [session, getUserName, scrollToBottom])

  const fetchMessages = async () => {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(200)

    if (error) { setLoading(false); return }

    if (data && data.length > 0) {
      const uniqueUserIds = [...new Set(data.map(m => m.user_id))]
      const { data: usersData } = await supabase
        .from('users')
        .select('id, first_name, surname')
        .in('id', uniqueUserIds)

      const newCache: Record<string, string> = {}
      usersData?.forEach(u => {
        newCache[u.id] = `${u.first_name} ${u.surname}`
      })
      usersCacheRef.current = newCache
      setUsersCache(newCache)

      setMessages(data.map(msg => ({
        ...msg,
        user_name: newCache[msg.user_id] || 'Unknown'
      })))
      scrollToBottom(false)
    }
    setLoading(false)
  }

  const sendTextMessage = async () => {
    if (!newMessage.trim() || !session) return
    setSending(true)
    const content = newMessage.trim()
    setNewMessage('')

    const { error } = await supabase
      .from('chat_messages')
      .insert({ user_id: session.id, message_type: 'text', content })

    if (error) {
      toast('Failed to send message', 'error')
      setNewMessage(content)
    }
    setSending(false)
    inputRef.current?.focus()
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('Please select an image file', 'warning')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('Image must be under 5MB', 'warning')
      return
    }
    const reader = new FileReader()
    reader.onloadend = () => setPreviewImage(reader.result as string)
    reader.readAsDataURL(file)
    setSelectedFile(file)
  }

  const sendImage = async () => {
    if (!selectedFile || !session) return
    setUploadingImage(true)

    const ext = selectedFile.name.split('.').pop()
    const fileName = `${session.id}_${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('chat-media')
      .upload(`chat-images/${fileName}`, selectedFile)

    if (uploadError) {
      toast('Failed to upload image', 'error')
      setUploadingImage(false)
      return
    }

    const { data: urlData } = supabase.storage
      .from('chat-media')
      .getPublicUrl(`chat-images/${fileName}`)

    const { error } = await supabase
      .from('chat_messages')
      .insert({ user_id: session.id, message_type: 'image', image_url: urlData.publicUrl })

    if (error) toast('Failed to send image', 'error')

    setPreviewImage(null)
    setSelectedFile(null)
    setUploadingImage(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    scrollToBottom()
  }

  const cancelImage = () => {
    setPreviewImage(null)
    setSelectedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleBack = () => {
    router.back()
  }

  const groupedMessages = groupMessagesByDate(messages)

  if (loading) {
    return (
      <div className="h-[100dvh] flex flex-col bg-[#ECE5DD]">
        <div className="flex items-center gap-3 px-4 py-3 bg-primary text-white safe-top">
          <button
            onClick={handleBack}
            className="w-10 h-10 min-h-0 min-w-0 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
          >
            <ArrowLeft size={22} />
          </button>
          <div>
            <p className="t-h3 text-white">Kitchen Chat</p>
            <p className="t-small text-white/70">Loading...</p>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-7 h-7 border-[3px] border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-[#ECE5DD]">
      {/* Custom Header with Back Button */}
      <div className="flex items-center gap-3 px-4 py-3 bg-primary text-white safe-top flex-shrink-0">
        <button
          onClick={handleBack}
          className="w-10 h-10 min-h-0 min-w-0 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors active:scale-95"
        >
          <ArrowLeft size={22} />
        </button>
        <div>
          <p className="t-h3 text-white">Kitchen Chat</p>
          <p className="t-small text-white/70">
            {messages.length} messages
          </p>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {messages.length === 0 && (
          <div className="text-center mt-16">
            <div className="inline-block bg-white/80 rounded-[10px] px-4 py-2">
              <p className="t-small text-text-secondary">No messages yet. Say hello! 👋</p>
            </div>
          </div>
        )}

        {groupedMessages.map(({ date, messages: dayMessages }) => (
          <div key={date}>
            <div className="flex justify-center my-4">
              <span className="bg-white/80 text-text-secondary t-small px-3 py-1 rounded-full">
                {date}
              </span>
            </div>

            {dayMessages.map((msg, idx) => {
              const isOwn = msg.user_id === session?.id
              const prevMsg = idx > 0 ? dayMessages[idx - 1] : null
              const showName = !isOwn && (!prevMsg || prevMsg.user_id !== msg.user_id)

              return (
                <div
                  key={msg.id}
                  className={`flex mb-0.5 ${isOwn ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[78%] flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>

                    {showName && (
                      <p className="t-small font-medium text-primary px-3 mb-0.5">
                        {msg.user_name}
                      </p>
                    )}

                    <div className={`relative px-3 py-2 rounded-[12px] ${
                      isOwn
                        ? 'bg-[#DCF8C6] text-[#111] rounded-tr-[4px]'
                        : 'bg-white text-[#111] rounded-tl-[4px]'
                    }`}>

                      {msg.message_type === 'text' && msg.content && (
                        <p className="t-body leading-relaxed break-words whitespace-pre-wrap pr-14">
                          {formatMessageText(msg.content)}
                        </p>
                      )}

                      {msg.message_type === 'image' && msg.image_url && (
                        <img
                          src={msg.image_url}
                          alt="Shared image"
                          className="max-w-full rounded-[8px] max-h-60 object-cover cursor-pointer"
                          onClick={() => window.open(msg.image_url!, '_blank')}
                        />
                      )}

                      <div className={`flex items-center gap-1 ${
                        msg.message_type === 'text'
                          ? 'absolute bottom-1.5 right-2'
                          : 'justify-end mt-1'
                      }`}>
                        <span className="text-[10px] text-[#667781]">
                          {new Date(msg.created_at).toLocaleTimeString('en-NG', {
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </span>
                        {isOwn && <CheckCheck size={14} className="text-[#53BDEB]" />}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Image preview overlay */}
      {previewImage && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex justify-between items-center px-4 py-3 bg-black/80 safe-top">
            <button
              onClick={cancelImage}
              className="text-white min-h-0 min-w-0 w-10 h-10 flex items-center justify-center"
            >
              <X size={22} />
            </button>
            <p className="t-body text-white">Send Image</p>
            <div className="w-10" />
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            <img
              src={previewImage}
              alt="Preview"
              className="max-w-full max-h-full object-contain rounded-[8px]"
            />
          </div>
          <div className="px-4 pb-6 pt-3 bg-black/80 safe-bottom">
            <button
              onClick={sendImage}
              disabled={uploadingImage}
              className="w-full bg-[#00A884] text-white py-3 rounded-full t-label flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Send size={18} />
              {uploadingImage ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {/* Input bar */}
      <div 
        className="flex-shrink-0 px-2 py-2 flex items-end gap-2 bg-[#ECE5DD] safe-bottom"
        style={{ 
          paddingBottom: keyboardVisible ? '8px' : 'max(8px, env(safe-area-inset-bottom, 8px))'
        }}
      >
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-10 h-10 min-h-0 min-w-0 rounded-full bg-white flex items-center justify-center text-text-secondary flex-shrink-0 shadow-sm active:scale-95 transition-transform"
        >
          <ImageIcon size={20} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />

        <div className="flex-1 bg-white rounded-[24px] px-4 py-2.5 flex items-center shadow-sm min-h-[44px]">
          <input
            ref={inputRef}
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendTextMessage()
              }
            }}
            placeholder="Type a message..."
            className="flex-1 bg-transparent outline-none t-body text-text-primary placeholder:text-text-muted"
            disabled={sending}
          />
        </div>

        <button
          onClick={sendTextMessage}
          disabled={!newMessage.trim() || sending}
          className="w-10 h-10 min-h-0 min-w-0 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm disabled:opacity-50 transition-colors active:scale-95 transform"
          style={{ background: newMessage.trim() ? '#00A884' : '#B0BEC5' }}
        >
          <Send size={18} className="text-white" />
        </button>
      </div>
    </div>
  )
}