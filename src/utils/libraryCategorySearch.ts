export function categoryMatchesSearch(category: string, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return !normalizedQuery || category.toLocaleLowerCase().includes(normalizedQuery);
}
