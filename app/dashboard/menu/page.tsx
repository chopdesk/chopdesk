'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import Spinner from '@/components/Spinner'
import { Plus, Edit, Trash2, X } from 'lucide-react'

type MenuItem = {
  id: string
  name: string
  category: string
  price: number
  unit: string
  available: boolean
}

export default function MenuManagement() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<MenuItem[]>([])
  const [showModal, setShowModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const [formData, setFormData] = useState({ name: '', category: '', price: '', unit: '' })

  useEffect(() => {
    const session = getSession()
    if (!session) {
      router.replace('/auth/login')
    } else {
      fetchMenuItems()
    }
  }, [router])

  const fetchMenuItems = async () => {
    const { data, error } = await supabase
      .from('menu_items')
      .select('*')
      .order('category', { ascending: true })

    if (!error && data) setItems(data)
    setLoading(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const itemData = {
      name: formData.name,
      category: formData.category,
      price: parseFloat(formData.price),
      unit: formData.unit,
      available: true,
    }

    if (editingItem) {
      const { error } = await supabase.from('menu_items').update(itemData).eq('id', editingItem.id)
      if (error) { toast('Error updating item: ' + error.message, 'error'); return }
      toast('Item updated', 'success')
    } else {
      const { error } = await supabase.from('menu_items').insert(itemData)
      if (error) { toast('Error creating item: ' + error.message, 'error'); return }
      toast('Item created', 'success')
    }

    fetchMenuItems()
    closeModal()
  }

  const toggleAvailability = async (item: MenuItem) => {
    const { error } = await supabase
      .from('menu_items')
      .update({ available: !item.available })
      .eq('id', item.id)

    if (!error) fetchMenuItems()
  }

  const deleteItem = async (id: string) => {
    const { error } = await supabase.from('menu_items').delete().eq('id', id)
    if (error) {
      toast('Error deleting item: ' + error.message, 'error')
    } else {
      toast('Item deleted', 'info')
      fetchMenuItems()
    }
    setDeleteConfirm(null)
  }

  const openModal = (item?: MenuItem) => {
    if (item) {
      setEditingItem(item)
      setFormData({ name: item.name, category: item.category, price: item.price.toString(), unit: item.unit })
    } else {
      setEditingItem(null)
      setFormData({ name: '', category: '', price: '', unit: '' })
    }
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingItem(null)
    setFormData({ name: '', category: '', price: '', unit: '' })
  }

  if (loading) {
    return <Spinner fullScreen />
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="t-h1 text-text-primary">Menu Items</h1>
        <button onClick={() => openModal()} className="btn-primary flex items-center gap-2 whitespace-nowrap">
          <Plus size={16} /> Add Item
        </button>
      </div>

      {/* Mobile: card list. Desktop (sm+): table */}
      <div className="sm:hidden space-y-3">
        {items.length === 0 ? (
          <div className="card text-center py-10">
            <p className="t-body text-text-muted">No menu items yet. Tap "Add Item" to create one.</p>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="card">
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <p className="t-body text-text-primary font-medium truncate">{item.name}</p>
                  <p className="t-small text-text-secondary">{item.category} · {item.unit}</p>
                  <p className="t-mono text-primary font-medium mt-1">₦{item.price.toLocaleString()}</p>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0 ml-3">
                  <button
                    onClick={() => toggleAvailability(item)}
                    className={`px-2 py-1 rounded-full t-small font-medium ${
                      item.available ? 'bg-[#2E7D32]/10 text-[#2E7D32]' : 'bg-danger/10 text-danger'
                    }`}
                  >
                    {item.available ? 'Available' : 'Unavailable'}
                  </button>
                  <div className="flex gap-1">
                    <button
                      onClick={() => openModal(item)}
                      className="text-[#1565C0] min-h-0 min-w-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#1565C0]/10"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(item.id)}
                      className="text-danger min-h-0 min-w-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-danger/10"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="hidden sm:block bg-white rounded-[10px] border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <table className="w-full">
              <thead className="bg-bg-subtle border-b border-border">
                <tr>
                  {['Name', 'Category', 'Unit', 'Price (₦)', 'Status', 'Actions'].map(h => (
                    <th key={h} className={`p-3 t-label text-text-secondary whitespace-nowrap ${h === 'Price (₦)' ? 'text-right' : h === 'Status' || h === 'Actions' ? 'text-center' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center p-8 t-body text-text-muted">
                      No menu items yet. Click "Add Item" to create one.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className="border-b border-border hover:bg-bg-subtle">
                      <td className="p-3 t-body text-text-primary whitespace-nowrap">{item.name}</td>
                      <td className="p-3 t-body text-text-secondary whitespace-nowrap">{item.category}</td>
                      <td className="p-3 t-body text-text-secondary whitespace-nowrap">{item.unit}</td>
                      <td className="p-3 text-right t-mono whitespace-nowrap">₦{item.price.toLocaleString()}</td>
                      <td className="p-3 text-center whitespace-nowrap">
                        <button
                          onClick={() => toggleAvailability(item)}
                          className={`px-2 py-1 rounded-full t-small font-medium min-w-[80px] ${
                            item.available ? 'bg-[#2E7D32]/10 text-[#2E7D32]' : 'bg-danger/10 text-danger'
                          }`}
                        >
                          {item.available ? 'Available' : 'Unavailable'}
                        </button>
                       </td>
                      <td className="p-3 text-center whitespace-nowrap">
                        <div className="flex justify-center gap-2">
                          <button
                            onClick={() => openModal(item)}
                            className="text-[#1565C0] min-h-0 min-w-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#1565C0]/10 transition-colors"
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(item.id)}
                            className="text-danger min-h-0 min-w-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-danger/10 transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                       </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50">
          <div className="bg-white w-full max-w-md rounded-t-[20px] p-5 modal-content">
            <div className="w-10 h-1 rounded-full bg-border mx-auto mb-5" />
            <div className="flex justify-between items-center mb-4">
              <p className="t-h2 text-text-primary">{editingItem ? 'Edit Item' : 'Add New Item'}</p>
              <button onClick={closeModal} className="text-text-muted min-h-0 min-w-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-bg-subtle">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              {[
                { label: 'Name', key: 'name', placeholder: 'e.g., Jollof Rice', type: 'text' },
                { label: 'Category', key: 'category', placeholder: 'e.g., Main, Soup, Swallow, Drinks', type: 'text' },
                { label: 'Unit', key: 'unit', placeholder: 'e.g., plate, bowl, bottle', type: 'text' },
                { label: 'Price (₦)', key: 'price', placeholder: '0.00', type: 'number' },
              ].map(({ label, key, placeholder, type }) => (
                <div key={key}>
                  <label className="block t-label text-text-primary mb-1">{label} *</label>
                  <input
                    type={type}
                    value={formData[key as keyof typeof formData]}
                    onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                    className="input-base"
                    placeholder={placeholder}
                    required
                  />
                </div>
              ))}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" className="btn-primary flex-1">{editingItem ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50">
          <div className="bg-white w-full max-w-md rounded-t-[20px] p-5">
            <div className="w-10 h-1 rounded-full bg-border mx-auto mb-5" />
            <p className="t-h2 text-text-primary">Delete this item?</p>
            <p className="t-body text-text-secondary mt-2">This cannot be undone.</p>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setDeleteConfirm(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={() => deleteItem(deleteConfirm)} className="btn-primary flex-1">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}