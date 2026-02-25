const normalizeString = (value) => String(value || '').toLowerCase();

export const normalizeMapperNeedles = (effectiveMapperName) =>
  String(effectiveMapperName || '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

export const isGuestDifficultyItem = (item, { ignoreGuestDifficulties, mapperNeedles }) => {
  if (!ignoreGuestDifficulties) return false;
  if (!Array.isArray(mapperNeedles) || mapperNeedles.length === 0) return false;

  const creator = normalizeString(item?.creator);
  const version = normalizeString(item?.version);

  return mapperNeedles.some((mapper) => {
    if (!creator.includes(mapper)) return false;
    if (version.includes(`${mapper}'s`) || version.includes(`${mapper}s'`)) return false;
    return version.includes("'s") || version.includes("s'");
  });
};

export const sortItems = (items, mode, direction) => {
  const sorted = [...items];
  const multiplier = direction === 'asc' ? 1 : -1;

  switch (mode) {
    case 'dateModified':
      sorted.sort((a, b) => ((a.dateModified || 0) - (b.dateModified || 0)) * multiplier);
      break;
    case 'name':
      sorted.sort((a, b) => {
        const nameA = `${a.artist || ''} - ${a.title || ''}`.toLowerCase();
        const nameB = `${b.artist || ''} - ${b.title || ''}`.toLowerCase();
        return nameA.localeCompare(nameB) * multiplier;
      });
      break;
    case 'progress':
      sorted.sort((a, b) => ((a.progress || 0) - (b.progress || 0)) * multiplier);
      break;
    case 'starRating':
      sorted.sort((a, b) => ((a.starRating || 0) - (b.starRating || 0)) * multiplier);
      break;
    case 'dateAdded':
    default:
      sorted.sort((a, b) => ((a.dateAdded || 0) - (b.dateAdded || 0)) * multiplier);
      break;
  }

  return sorted;
};

export const filterItems = (items, query, srFilter) => {
  let filtered = items;
  const needle = String(query || '').trim().toLowerCase();
  const min = Number(srFilter?.min ?? 0);
  const max = Number(srFilter?.max ?? 10);

  if (needle) {
    filtered = filtered.filter((item) => {
      const fields = [
        item.title,
        item.titleUnicode,
        item.artist,
        item.artistUnicode,
        item.creator,
        item.version,
        item.beatmapSetID,
      ];

      return fields.filter(Boolean).some((value) => String(value).toLowerCase().includes(needle));
    });
  }

  const isDefaultRange = min === 0 && max >= 10;
  if (!isDefaultRange) {
    filtered = filtered.filter((item) => {
      const sr = Number(item.starRating || 0);
      if (max >= 10) {
        return sr >= min;
      }
      return sr >= min && sr <= max;
    });
  }

  return filtered;
};

export const computeTabStats = (state) => {
  const items = Array.isArray(state?.beatmapItems) ? state.beatmapItems : [];
  const todoIds = Array.isArray(state?.todoIds) ? state.todoIds : [];
  const doneIds = Array.isArray(state?.doneIds) ? state.doneIds : [];
  const mapperNeedles = normalizeMapperNeedles(state?.effectiveMapperName);
  const ignoreGuestDifficulties = !!state?.settings?.ignoreGuestDifficulties;

  const guestFilter = (item) =>
    !isGuestDifficultyItem(item, { ignoreGuestDifficulties, mapperNeedles });

  const itemMap = new Map(items.map((item) => [item.id, item]));
  const all = items.filter(guestFilter).length;
  const todo = todoIds.reduce((count, id) => {
    const item = itemMap.get(id);
    return item && guestFilter(item) ? count + 1 : count;
  }, 0);
  const completed = doneIds.reduce((count, id) => {
    const item = itemMap.get(id);
    return item && guestFilter(item) ? count + 1 : count;
  }, 0);

  return { all, todo, completed };
};

// ─────────────────────────────────────────────────────────────────────────────
// computeItemsForView – memoized with cheap reference-identity cache keys.
//
// The old JSON.stringify cache key was O(n) string allocation on every call.
// We now use object references + a few scalars so cache hits are O(1).
// ─────────────────────────────────────────────────────────────────────────────
let _cachedItems = null;
let _cachedResult = null;

// Reference slots for cheap equality
let _cItems = null, _cTodo = null, _cDone = null;
let _cViewMode = null, _cSortMode = null, _cSortDir = null;
let _cSearch = null, _cSrMin = null, _cSrMax = null;
let _cMapper = null, _cGuest = null;

export const computeItemsForView = (state) => {
  const items = Array.isArray(state?.beatmapItems) ? state.beatmapItems : [];
  const todoIds = Array.isArray(state?.todoIds) ? state.todoIds : [];
  const doneIds = Array.isArray(state?.doneIds) ? state.doneIds : [];
  const viewMode = state?.viewMode || 'all';
  const sortMode = state?.sortState?.mode || 'dateAdded';
  const sortDir = state?.sortState?.direction || 'desc';
  const search = state?.searchQuery || '';
  const srMin = Number(state?.srFilter?.min ?? 0);
  const srMax = Number(state?.srFilter?.max ?? 10);
  const mapper = state?.effectiveMapperName || '';
  const guest = !!state?.settings?.ignoreGuestDifficulties;

  // Cache hit: all inputs unchanged
  if (
    _cachedResult !== null &&
    items === _cItems &&
    todoIds === _cTodo &&
    doneIds === _cDone &&
    viewMode === _cViewMode &&
    sortMode === _cSortMode &&
    sortDir === _cSortDir &&
    search === _cSearch &&
    srMin === _cSrMin &&
    srMax === _cSrMax &&
    mapper === _cMapper &&
    guest === _cGuest
  ) {
    return _cachedResult;
  }

  // Update cache keys
  _cItems = items; _cTodo = todoIds; _cDone = doneIds;
  _cViewMode = viewMode; _cSortMode = sortMode; _cSortDir = sortDir;
  _cSearch = search; _cSrMin = srMin; _cSrMax = srMax;
  _cMapper = mapper; _cGuest = guest;

  const sortState = { mode: sortMode, direction: sortDir };
  const srFilter = { min: srMin, max: srMax };
  const mapperNeedles = normalizeMapperNeedles(mapper);
  const guestFilter = (item) =>
    !isGuestDifficultyItem(item, { ignoreGuestDifficulties: guest, mapperNeedles });
  const itemMap = new Map(items.map((item) => [item.id, item]));

  let result;
  if (viewMode === 'todo') {
    result = todoIds.map((id) => itemMap.get(id)).filter(Boolean).filter(guestFilter);
  } else if (viewMode === 'completed') {
    result = doneIds.map((id) => itemMap.get(id)).filter(Boolean).filter(guestFilter);
  } else {
    const visibleItems = items.filter(guestFilter);
    const filtered = filterItems(visibleItems, search, srFilter);
    result = sortItems(filtered, sortState.mode, sortState.direction);
  }

  _cachedResult = result;
  return result;
};

export const getGroupKey = (item) =>
  `${(item.artistUnicode || item.artist || '').toLowerCase()}||${(item.titleUnicode || item.title || '').toLowerCase()}||${(item.creator || '').toLowerCase()}`;

export const groupItemsBySong = (items) => {
  const map = new Map();
  const order = [];
  for (const item of items) {
    const key = getGroupKey(item);
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key).push(item);
  }
  return order.map((key) => ({ key, items: map.get(key) }));
};

export const computeGroupedItemsForView = (state) => {
  const viewMode = state?.viewMode || 'all';
  const groupMapsBySong = !!state?.settings?.groupMapsBySong;
  if (!groupMapsBySong || viewMode !== 'all') {
    return [];
  }

  const items = computeItemsForView(state);
  return groupItemsBySong(items);
};
