// A képek címe az admin felületen. Ami az éles ágon (main) is megvan, azt az oldal közvetlenül adja;
// az újonnan feltöltött, még nem publikált képek csak a piszkozat-ágon vannak, ezeket az /api/image szolgálja ki.
export function assetUrl(path, mainImages) {
  if (!path) return '';
  if (!mainImages || mainImages.has(path)) return path;
  return `/api/image?path=${encodeURIComponent(path)}`;
}
