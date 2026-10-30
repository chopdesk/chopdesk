export function sortByAvailability<T extends { id: string }>(
  items: T[],
  remainingById: Record<string, number>
): T[] {
  // 0 = available now, 1 = sold out this shift, 2 = not in this shift's stock
  const rank = (item: T): number => {
    const remaining = remainingById[item.id];
    if (remaining === undefined) return 2;
    return remaining > 0 ? 0 : 1;
  };

  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map((entry) => entry.item);
}
