import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import items from "./data/items.json";
import bosses from "./data/bosses.json";
import "./styles.css";

const normalize = (value) => String(value || "").toLowerCase().trim();

const itemByName = new Map(items.map((item) => [item.name, item]));
const bossByName = new Map(bosses.map((boss) => [boss.name, boss]));
const itemIndexByName = new Map(items.map((item, index) => [item.name, index]));
const priusSeriesStart = itemIndexByName.get("Prius Silver Coin");
const priusSeriesEnd = itemIndexByName.get("Prius Platinum Coin");
const coinSeriesNames = new Set([
  "Prius Silver Coin",
  "Prius Gold Coin",
  "Prius Platinum Coin",
  "Coin of Effort",
]);
const purchasableCoinNames = ["Prius Silver Coin", "Prius Gold Coin", "Prius Platinum Coin"];
const storageKey = "twrpg-helper-state";
const themeStorageKey = "twrpg-helper-theme";
const autoInputDelayStorageKey = "twrpg-helper-auto-input-delay-ms";
const fileApi = typeof window !== "undefined" ? window.twrpgFileApi : null;

function loadSavedTheme() {
  if (typeof window === "undefined") return "light";
  return window.localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
}

function loadSavedAutoInputDelayMs() {
  if (typeof window === "undefined") return 700;
  const parsed = Number(window.localStorage.getItem(autoInputDelayStorageKey));
  return Number.isFinite(parsed) && parsed >= 80 && parsed <= 3000 ? parsed : 700;
}

function createPreset({ id, name, saveText = "", saveFilePath = "", selected = [] }) {
  return {
    id,
    name,
    saveText,
    saveFilePath,
    selected: selected
      .map((target) => ({ name: target.name, quantity: Number(target.quantity) }))
      .filter((target) => itemByName.has(target.name) && target.quantity > 0),
  };
}

function loadSavedState() {
  if (typeof window === "undefined") {
    return {
      activePresetId: "default",
      presets: [createPreset({ id: "default", name: "기본" })],
    };
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
    const presets = Array.isArray(parsed.presets)
      ? parsed.presets
          .map((preset, index) =>
            createPreset({
              id: typeof preset.id === "string" ? preset.id : `preset-${index + 1}`,
              name: typeof preset.name === "string" && preset.name.trim() ? preset.name.trim() : `프리셋 ${index + 1}`,
              saveText: typeof preset.saveText === "string" ? preset.saveText : "",
              saveFilePath: typeof preset.saveFilePath === "string" ? preset.saveFilePath : "",
              selected: Array.isArray(preset.selected) ? preset.selected : [],
            }),
          )
          .filter((preset) => preset.id)
      : [];

    if (presets.length) {
      const activePresetId = presets.some((preset) => preset.id === parsed.activePresetId)
        ? parsed.activePresetId
        : presets[0].id;

      return { activePresetId, presets };
    }

    const migratedPreset = createPreset({
      id: "default",
      name: "기본",
      saveText: typeof parsed.saveText === "string" ? parsed.saveText : "",
      saveFilePath: typeof parsed.saveFilePath === "string" ? parsed.saveFilePath : "",
      selected: Array.isArray(parsed.selected) ? parsed.selected : [],
    });

    return {
      activePresetId: migratedPreset.id,
      presets: [migratedPreset],
    };
  } catch {
    return {
      activePresetId: "default",
      presets: [createPreset({ id: "default", name: "기본" })],
    };
  }
}

function shouldStopDecomposing(item) {
  if (!item || priusSeriesStart == null || priusSeriesEnd == null) return false;
  const index = itemIndexByName.get(item.name);
  const recipe = flattenRecipe(item.recipe);
  const isInPriusSeriesBlock = index >= priusSeriesStart && index <= priusSeriesEnd;
  const isBossDropCoinExchange =
    Array.isArray(item.dropped_by) &&
    recipe.length > 0 &&
    recipe.every((ingredient) => coinSeriesNames.has(ingredient.name));

  return isInPriusSeriesBlock || isBossDropCoinExchange;
}

function parseSaveFile(raw) {
  const sectionNames = new Set(["Hero Inventory", "Bag", "Storage"]);
  const inventory = new Map();
  const sections = {};
  const loadCodes = [];
  let activeSection = null;

  const preloadRegex = /Preload\(\s*"([^"]*)"\s*\)/g;
  const lines = [...raw.matchAll(preloadRegex)].map((match) => match[1].trim());

  for (const line of lines) {
    const loadCodeMatch = line.match(/^Load Code\s+(\d+):\s*(-load\s+.+)$/i);
    if (loadCodeMatch) {
      loadCodes.push({
        id: loadCodeMatch[1],
        label: `Load Code ${loadCodeMatch[1]}`,
        code: loadCodeMatch[2].trim(),
      });
      continue;
    }

    const sectionMatch = line.match(/^-{5,}(.+?)-{5,}$/);
    if (sectionMatch) {
      const name = sectionMatch[1].trim();
      activeSection = sectionNames.has(name) ? name : null;
      if (activeSection) sections[activeSection] = [];
      continue;
    }

    if (!activeSection) continue;

    const itemMatch = line.match(/^\d+\.\s*(.+)$/);
    if (!itemMatch) continue;

    const parsedItem = parseInventoryItemLine(itemMatch[1]);
    const { name: itemName, count } = parsedItem;
    sections[activeSection].push(itemName);
    inventory.set(itemName, (inventory.get(itemName) || 0) + count);
  }

  return {
    inventory,
    sections,
    loadCodes,
    total: [...inventory.values()].reduce((sum, count) => sum + count, 0),
  };
}

function parseInventoryItemLine(rawName) {
  const trimmed = rawName.trim();
  const quantityMatch = trimmed.match(/^(.*?)\s+x(\d+)$/i);

  if (!quantityMatch) return { name: trimmed, count: 1 };

  const name = quantityMatch[1].trim();
  const count = Number(quantityMatch[2]);

  return {
    name,
    count: Number.isFinite(count) && count > 0 ? count : 1,
  };
}

function parseSaveClass(raw) {
  const match = raw.match(/Preload\(\s*"Class:\s*([^"]+)"\s*\)/);
  return match?.[1]?.trim() || "";
}

function flattenRecipe(recipe = []) {
  const result = [];
  for (const entry of recipe) {
    for (const [name, count] of Object.entries(entry)) {
      result.push({ name, count: Number(count) || 0 });
    }
  }
  return result;
}

function calculateMissing(selected, ownedInventory) {
  const available = new Map(ownedInventory);
  const missing = new Map();

  const requireItem = (name, count) => {
    if (count <= 0) return;

    const owned = available.get(name) || 0;
    const used = Math.min(owned, count);
    if (used > 0) available.set(name, owned - used);

    const needed = count - used;
    if (needed <= 0) return;

    const item = itemByName.get(name);
    const recipe = flattenRecipe(item?.recipe);

    if (!recipe.length || shouldStopDecomposing(item)) {
      missing.set(name, (missing.get(name) || 0) + needed);
      return;
    }

    for (const ingredient of recipe) {
      requireItem(ingredient.name, ingredient.count * needed);
    }
  };

  for (const target of selected) {
    requireItem(target.name, target.quantity);
  }

  return [...missing.entries()]
    .map(([name, count]) => ({ item: itemByName.get(name), name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function calculateConsumedInventory(selected, ownedInventory) {
  const available = new Map(ownedInventory);
  const consumed = new Map();

  const requireItem = (name, count) => {
    if (count <= 0) return;

    const owned = available.get(name) || 0;
    const used = Math.min(owned, count);
    if (used > 0) {
      available.set(name, owned - used);
      consumed.set(name, (consumed.get(name) || 0) + used);
    }

    const needed = count - used;
    if (needed <= 0) return;

    const item = itemByName.get(name);
    const recipe = flattenRecipe(item?.recipe);

    if (!recipe.length || shouldStopDecomposing(item)) return;

    for (const ingredient of recipe) {
      requireItem(ingredient.name, ingredient.count * needed);
    }
  };

  for (const target of selected) {
    requireItem(target.name, target.quantity);
  }

  return consumed;
}

function calculateDiscardableItems(selected, ownedInventory) {
  if (!selected.length) return [];

  const consumed = calculateConsumedInventory(selected, ownedInventory);

  return [...ownedInventory.entries()]
    .map(([name, count]) => ({
      item: itemByName.get(name),
      name,
      count: count - (consumed.get(name) || 0),
    }))
    .filter((entry) => entry.count > 0)
    .filter((entry) => !shouldExcludeDiscardableItem(entry.item, entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function shouldExcludeDiscardableItem(item, name) {
  const normalizedName = normalize(name);
  const normalizedType = normalize(item?.type);

  return (
    normalizedName.includes("coin") ||
    normalizedType.includes("coin") ||
    normalizedName.includes("pickaxe") ||
    normalizedType.includes("pickaxe") ||
    normalizedName.includes("'s soul") ||
    /\bsoul\b/.test(normalizedName)
  );
}

function getHighestDropBossLevel(item) {
  const sources = Array.isArray(item?.dropped_by) ? item.dropped_by : [];
  const levels = sources
    .map((source) => getBossLevel(source))
    .filter((level) => level > -1);

  return levels.length ? Math.max(...levels) : -1;
}

function groupDiscardableItems(discardableItems) {
  const groups = [
    { key: "lv100", title: "100lv 보스", label: "은화", items: [] },
    { key: "lv110", title: "110lv 보스", label: "금화", items: [] },
    { key: "lv120", title: "120lv 이상 보스", label: "백금화", items: [] },
    { key: "other", title: "그 외", label: "기타", items: [] },
  ];

  const groupByKey = new Map(groups.map((group) => [group.key, group]));

  for (const entry of discardableItems) {
    const level = getHighestDropBossLevel(entry.item);
    const key = level >= 120 ? "lv120" : level === 110 ? "lv110" : level === 100 ? "lv100" : "other";
    groupByKey.get(key).items.push(entry);
  }

  return groups;
}

function canSatisfyItem(name, count, ownedInventory) {
  const available = new Map(ownedInventory);

  const requireItem = (itemName, itemCount, seen = new Set()) => {
    if (itemCount <= 0) return true;

    const owned = available.get(itemName) || 0;
    const used = Math.min(owned, itemCount);
    if (used > 0) available.set(itemName, owned - used);

    const needed = itemCount - used;
    if (needed <= 0) return true;

    const item = itemByName.get(itemName);
    const recipe = flattenRecipe(item?.recipe);

    if (!recipe.length || shouldStopDecomposing(item) || seen.has(itemName)) return false;

    const nextSeen = new Set(seen);
    nextSeen.add(itemName);

    return recipe.every((ingredient) => requireItem(ingredient.name, ingredient.count * needed, nextSeen));
  };

  return requireItem(name, count);
}

function getBossLevel(source) {
  const level = Number(bossByName.get(source)?.level);
  return Number.isFinite(level) ? level : -1;
}

function groupMissingBySource(missingMaterials) {
  const grouped = new Map();

  for (const material of missingMaterials) {
    const sources = Array.isArray(material.item?.dropped_by) ? material.item.dropped_by : [];
    const groupSources = sources.length ? sources : ["획득처 데이터 없음"];

    for (const source of groupSources) {
      if (!grouped.has(source)) {
        const boss = bossByName.get(source);
        grouped.set(source, {
          source,
          boss,
          level: boss ? getBossLevel(source) : -1,
          items: [],
        });
      }

      grouped.get(source).items.push(material);
    }
  }

  return [...grouped.values()].sort((a, b) => {
    if (b.level !== a.level) return b.level - a.level;
    return a.source.localeCompare(b.source);
  });
}

function calculateCoinSummary(missingMaterials, ownedInventory) {
  const summary = new Map(purchasableCoinNames.map((name) => [name, 0]));

  for (const material of missingMaterials) {
    if (summary.has(material.name)) {
      summary.set(material.name, summary.get(material.name) + material.count);
      continue;
    }

    const recipe = flattenRecipe(material.item?.recipe);
    const isCoinPurchase = recipe.length > 0 && recipe.every((ingredient) => summary.has(ingredient.name));

    if (!isCoinPurchase) continue;

    for (const ingredient of recipe) {
      summary.set(ingredient.name, summary.get(ingredient.name) + ingredient.count * material.count);
    }
  }

  return purchasableCoinNames.map((name) => ({
    name,
    koreanname: itemByName.get(name)?.koreanname,
    needed: summary.get(name) || 0,
    owned: ownedInventory.get(name) || 0,
  }));
}

function formatStatLabel(key) {
  return key
    .replace(/percent$/i, " %")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

function formatStatValue(value) {
  if (typeof value === "number") return Number.isInteger(value) ? value : value.toLocaleString();
  return String(value);
}

function ItemStatsContent({ item }) {
  const stats = item?.stats || {};
  const entries = Object.entries(stats);

  return (
    <>
      <strong>Stats</strong>
      {entries.length ? (
        <div className="stats-list">
          {entries.map(([key, value]) => (
            <div key={key} className="stats-entry">
              <span>{formatStatLabel(key)}</span>
              {Array.isArray(value) ? (
                <ul>
                  {value.map((line, index) => (
                    <li key={`${key}-${index}`}>{line}</li>
                  ))}
                </ul>
              ) : (
                <small>{formatStatValue(value)}</small>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p>stats 정보 없음</p>
      )}
    </>
  );
}

function getTooltipPosition(anchor) {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 24);
  const left = Math.min(Math.max(rect.right + 10, 12), window.innerWidth - width - 12);
  const below = rect.bottom + 8;
  const top = below + 260 > window.innerHeight ? Math.max(12, rect.top - 270) : below;

  return { left, top, width };
}

function RecipeTree({ itemName, ownedInventory, depth = 0, seen = new Set() }) {
  const item = itemByName.get(itemName);
  const recipe = flattenRecipe(item?.recipe);

  if (!recipe.length || shouldStopDecomposing(item) || seen.has(itemName)) return null;

  const nextSeen = new Set(seen);
  nextSeen.add(itemName);

  return (
    <ul className="recipe-tree" style={{ "--depth": depth }}>
      {recipe.map((ingredient) => {
        const ownedCount = ownedInventory.get(ingredient.name) || 0;
        const isFullyOwned = ownedCount >= ingredient.count;
        const isReady = canSatisfyItem(ingredient.name, ingredient.count, ownedInventory);

        return (
          <li
            key={`${itemName}-${ingredient.name}`}
            className={isReady ? "recipe-ready" : undefined}
          >
            <span>{ingredient.name}</span>
            <strong>x{ingredient.count}</strong>
            {ownedCount > 0 && <small>보유 x{ownedCount}</small>}
            {!isFullyOwned && (
              <RecipeTree
                itemName={ingredient.name}
                ownedInventory={ownedInventory}
                depth={depth + 1}
                seen={nextSeen}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function App() {
  const savedState = useMemo(() => loadSavedState(), []);
  const [presets, setPresets] = useState(savedState.presets);
  const [activePresetId, setActivePresetId] = useState(savedState.activePresetId);
  const [query, setQuery] = useState("");
  const [hoveredStats, setHoveredStats] = useState(null);
  const [hideStatsTimerId, setHideStatsTimerId] = useState(null);
  const [copiedLoadCodeId, setCopiedLoadCodeId] = useState("");
  const [isTypingLoadCodes, setIsTypingLoadCodes] = useState(false);
  const [autoInputDelayMs, setAutoInputDelayMs] = useState(() => loadSavedAutoInputDelayMs());
  const [theme, setTheme] = useState(() => loadSavedTheme());

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify({ activePresetId, presets }));
  }, [activePresetId, presets]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(autoInputDelayStorageKey, String(autoInputDelayMs));
  }, [autoInputDelayMs]);

  useEffect(() => {
    return () => {
      if (hoveredStats?.timerId) window.clearTimeout(hoveredStats.timerId);
      if (hideStatsTimerId) window.clearTimeout(hideStatsTimerId);
    };
  }, [hoveredStats, hideStatsTimerId]);

  const activePreset = presets.find((preset) => preset.id === activePresetId) || presets[0];
  const saveText = activePreset?.saveText || "";
  const saveFilePath = activePreset?.saveFilePath || "";
  const selected = activePreset?.selected || [];

  const updateActivePreset = (updater) => {
    setPresets((current) =>
      current.map((preset) => (preset.id === activePresetId ? { ...preset, ...updater(preset) } : preset)),
    );
  };

  const setSaveText = (value) => {
    updateActivePreset(() => ({ saveText: value }));
  };

  const setSaveFile = ({ path = "", text = "" }) => {
    updateActivePreset(() => ({ saveFilePath: path, saveText: text }));
  };

  const setSelected = (updater) => {
    updateActivePreset((preset) => ({
      selected: typeof updater === "function" ? updater(preset.selected) : updater,
    }));
  };

  const parsedSave = useMemo(() => parseSaveFile(saveText), [saveText]);

  const filteredItems = useMemo(() => {
    const q = normalize(query);
    return items
      .filter((item) => {
        if (!q) return item.recipe?.length;
        return (
          normalize(item.name).includes(q) ||
          normalize(item.koreanname).includes(q) ||
          normalize(item.type).includes(q)
        );
      })
      .slice(0, 80);
  }, [query]);

  const missingMaterials = useMemo(
    () => calculateMissing(selected, parsedSave.inventory),
    [selected, parsedSave.inventory],
  );
  const missingGroups = useMemo(() => groupMissingBySource(missingMaterials), [missingMaterials]);
  const coinSummary = useMemo(
    () => calculateCoinSummary(missingMaterials, parsedSave.inventory),
    [missingMaterials, parsedSave.inventory],
  );
  const discardableItems = useMemo(
    () => calculateDiscardableItems(selected, parsedSave.inventory),
    [selected, parsedSave.inventory],
  );
  const discardableGroups = useMemo(() => groupDiscardableItems(discardableItems), [discardableItems]);

  const selectedCount = selected.reduce((sum, item) => sum + item.quantity, 0);
  const canAutoTypeLoadCodes = fileApi?.platform === "win32" && typeof fileApi.typeLoadCodes === "function";

  const addTarget = (item) => {
    setSelected((current) => {
      const exists = current.find((target) => target.name === item.name);
      if (exists) {
        return current.map((target) =>
          target.name === item.name ? { ...target, quantity: target.quantity + 1 } : target,
        );
      }
      return [...current, { name: item.name, quantity: 1 }];
    });
  };

  const updateQuantity = (name, quantity) => {
    setSelected((current) =>
      current
        .map((target) => (target.name === name ? { ...target, quantity } : target))
        .filter((target) => target.quantity > 0),
    );
  };

  const removeTarget = (name) => {
    setSelected((current) => current.filter((target) => target.name !== name));
  };

  const selectSaveFile = async () => {
    if (!fileApi) return;

    try {
      const result = await fileApi.selectSaveFile();
      if (result) setSaveFile(result);
    } catch (error) {
      window.alert(`파일을 읽지 못했습니다: ${error.message}`);
    }
  };

  const refreshSaveFile = async () => {
    if (!fileApi || !saveFilePath) return;

    try {
      const result = await fileApi.readSaveFile(saveFilePath);
      const previousClass = parseSaveClass(saveText);
      const nextClass = parseSaveClass(result.text);

      if (saveText && previousClass && nextClass && previousClass !== nextClass) {
        try {
          await fileApi.backupSaveFile({
            presetName: activePreset?.name || "preset",
            text: saveText,
          });
        } catch (backupError) {
          window.alert(`클래스 변경 감지 후 기존 세이브 백업에 실패했습니다: ${backupError.message}`);
          return;
        }
      }

      setSaveFile(result);
    } catch (error) {
      window.alert(`파일을 다시 읽지 못했습니다: ${error.message}`);
    }
  };

  const showStatsLater = (item, event) => {
    if (hideStatsTimerId) {
      window.clearTimeout(hideStatsTimerId);
      setHideStatsTimerId(null);
    }

    const position = getTooltipPosition(event.currentTarget);
    const timerId = window.setTimeout(() => {
      setHoveredStats({ item, position, timerId: null });
    }, 300);

    setHoveredStats((current) => {
      if (current?.timerId) window.clearTimeout(current.timerId);
      return { item, position, timerId };
    });
  };

  const hideStats = () => {
    const timerId = window.setTimeout(() => {
      setHoveredStats((current) => {
        if (current?.timerId) window.clearTimeout(current.timerId);
        return null;
      });
      setHideStatsTimerId(null);
    }, 180);

    setHideStatsTimerId((current) => {
      if (current) window.clearTimeout(current);
      return timerId;
    });
  };

  const keepStatsOpen = () => {
    if (!hideStatsTimerId) return;
    window.clearTimeout(hideStatsTimerId);
    setHideStatsTimerId(null);
  };

  const hideStatsImmediately = () => {
    setHoveredStats((current) => {
      if (current?.timerId) window.clearTimeout(current.timerId);
      return null;
    });
    if (hideStatsTimerId) {
      window.clearTimeout(hideStatsTimerId);
      setHideStatsTimerId(null);
    }
  };

  const addPreset = () => {
    const id = `preset-${Date.now()}`;
    const nextPreset = createPreset({
      id,
      name: `프리셋 ${presets.length + 1}`,
    });

    setPresets((current) => [...current, nextPreset]);
    setActivePresetId(id);
    setQuery("");
  };

  const renamePreset = (name) => {
    updateActivePreset(() => ({ name }));
  };

  const deletePreset = () => {
    if (presets.length <= 1) return;

    const nextPresets = presets.filter((preset) => preset.id !== activePresetId);
    setPresets(nextPresets);
    setActivePresetId(nextPresets[0].id);
    setQuery("");
  };

  const copyLoadCode = async (loadCode) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(loadCode.code);
      } else {
        const copyTarget = document.createElement("textarea");
        copyTarget.value = loadCode.code;
        copyTarget.setAttribute("readonly", "");
        copyTarget.style.position = "fixed";
        copyTarget.style.opacity = "0";
        document.body.appendChild(copyTarget);
        copyTarget.select();
        document.execCommand("copy");
        document.body.removeChild(copyTarget);
      }

      setCopiedLoadCodeId(loadCode.id);
      window.setTimeout(() => setCopiedLoadCodeId(""), 1200);
    } catch (error) {
      window.alert(`로드 코드를 복사하지 못했습니다: ${error.message}`);
    }
  };

  const typeLoadCodesToWarcraft = async () => {
    if (!canAutoTypeLoadCodes || isTypingLoadCodes || !parsedSave.loadCodes.length) return;

    const confirmed = window.confirm(
      "Warcraft 3 창을 활성화한 뒤 로드 코드를 자동 입력합니다.\n입력 중에는 키보드와 마우스를 조작하지 마세요.",
    );
    if (!confirmed) return;

    setIsTypingLoadCodes(true);
    try {
      await fileApi.typeLoadCodes({
        codes: parsedSave.loadCodes.map((loadCode) => loadCode.code),
        windowTitle: "Warcraft",
        startDelayMs: 1200,
        delayMs: autoInputDelayMs,
      });
    } catch (error) {
      window.alert(`로드 코드 자동 입력에 실패했습니다: ${error.message}`);
    } finally {
      setIsTypingLoadCodes(false);
    }
  };

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">TWRPG Helper</p>
          <h1>아이템 제작 재료 계산기</h1>
        </div>
        <button
          type="button"
          className="theme-toggle"
          onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
        <div className="preset-controls">
          <select
            value={activePresetId}
            onChange={(event) => {
              setActivePresetId(event.target.value);
              setQuery("");
            }}
            aria-label="프리셋 선택"
          >
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name || "이름 없음"}
              </option>
            ))}
          </select>
          <input
            value={activePreset?.name || ""}
            onChange={(event) => renamePreset(event.target.value)}
            aria-label="프리셋 이름"
            placeholder="프리셋 이름"
          />
          <button type="button" onClick={addPreset}>
            새 프리셋
          </button>
          <button type="button" onClick={deletePreset} disabled={presets.length <= 1}>
            삭제
          </button>
        </div>
        <div className="summary-strip">
          <span>보유 {parsedSave.total}</span>
          <span>목표 {selectedCount}</span>
          <span>부족 {missingMaterials.length}</span>
        </div>
      </header>

      <section className="save-strip">
        <div className="save-strip-head">
          <div>
            <strong>세이브 파일</strong>
            <small>{fileApi && saveFilePath ? saveFilePath : "PreloadFiles 내용을 붙여넣거나 Electron 앱에서 파일을 선택하세요."}</small>
          </div>
          <div className="save-actions">
            {fileApi && (
              <>
                <button type="button" onClick={selectSaveFile}>
                  파일 선택
                </button>
                <button type="button" onClick={refreshSaveFile} disabled={!saveFilePath}>
                  새로고침
                </button>
              </>
            )}
            <button type="button" onClick={() => setSaveText("")}>
              초기화
            </button>
          </div>
        </div>
        <textarea
          value={saveText}
          onChange={(event) => setSaveText(event.target.value)}
          placeholder="PreloadFiles 내용 전체를 붙여넣으세요."
        />
      </section>

      <section className="load-code-strip" aria-label="로드 코드">
        <div className="load-code-head">
          <div>
            <strong>로드 코드</strong>
            <small>{parsedSave.loadCodes.length ? `${parsedSave.loadCodes.length}개 감지됨` : "세이브 텍스트에서 Load Code를 찾지 못했습니다."}</small>
          </div>
          {canAutoTypeLoadCodes && (
            <div className="auto-type-controls">
              <label>
                <span>Input delay ms</span>
                <input
                  type="number"
                  min="80"
                  max="3000"
                  step="50"
                  value={autoInputDelayMs}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    if (Number.isFinite(nextValue)) {
                      setAutoInputDelayMs(Math.max(80, Math.min(nextValue, 3000)));
                    }
                  }}
                  disabled={isTypingLoadCodes}
                />
              </label>
              <button
                type="button"
                className="auto-type-button"
                onClick={typeLoadCodesToWarcraft}
                disabled={isTypingLoadCodes || !parsedSave.loadCodes.length}
              >
                {isTypingLoadCodes ? "입력 중" : "Warcraft 3 자동 입력"}
              </button>
            </div>
          )}
        </div>
        <div className="load-code-list">
          {parsedSave.loadCodes.map((loadCode) => (
            <div key={loadCode.id} className="load-code-row">
              <span>{loadCode.label}</span>
              <code>{loadCode.code}</code>
              <button type="button" onClick={() => copyLoadCode(loadCode)}>
                {copiedLoadCodeId === loadCode.id ? "복사됨" : "복사"}
              </button>
            </div>
          ))}
          {!parsedSave.loadCodes.length && <p className="empty">Load Code 1/2/3 형식의 코드가 여기에 표시됩니다.</p>}
        </div>
      </section>

      <section className="workspace">
        <section className="panel search-panel">
          <div className="panel-head">
            <h2>목표 아이템 검색</h2>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="영문 또는 한글 이름으로 검색"
          />

          <div className="item-grid">
            {filteredItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="item-card"
                onClick={() => addTarget(item)}
              >
                <span className="rank" style={{ color: `#${item.color || "4b5563"}` }}>
                  {item.rank === "none" ? item.type : item.rank}
                </span>
                <strong
                  className="item-name-hover"
                  onMouseEnter={(event) => showStatsLater(item, event)}
                  onMouseLeave={hideStats}
                  onFocus={(event) => showStatsLater(item, event)}
                  onBlur={hideStats}
                  tabIndex="0"
                >
                  {item.name}
                </strong>
                <small>{item.koreanname || "한글 이름 없음"}</small>
              </button>
            ))}
          </div>
        </section>

        <aside className="panel target-panel">
          <div className="panel-head">
            <h2>목표 아이템</h2>
          </div>

          <div className="target-list">
            {selected.map((target) => {
              const item = itemByName.get(target.name);
              const isTargetReady = canSatisfyItem(target.name, target.quantity, parsedSave.inventory);
              return (
                <article
                  key={target.name}
                  className={`target-card ${isTargetReady ? "target-ready" : ""}`}
                >
                  <div className="target-title">
                    <div>
                      <strong
                        className="item-name-hover"
                        onMouseEnter={(event) => showStatsLater(item, event)}
                        onMouseLeave={hideStats}
                        onFocus={(event) => showStatsLater(item, event)}
                        onBlur={hideStats}
                        tabIndex="0"
                      >
                        {target.name}
                      </strong>
                      <small>{item?.koreanname}</small>
                    </div>
                    <div className="target-actions">
                      <input
                        type="number"
                        min="0"
                        value={target.quantity}
                        onChange={(event) => updateQuantity(target.name, Number(event.target.value))}
                        aria-label={`${target.name} 수량`}
                      />
                      <button type="button" onClick={() => removeTarget(target.name)} aria-label={`${target.name} 삭제`}>
                        ×
                      </button>
                    </div>
                  </div>
                  <RecipeTree itemName={target.name} ownedInventory={parsedSave.inventory} />
                </article>
              );
            })}
            {!selected.length && <p className="empty">검색 결과를 눌러 목표 아이템을 추가하세요.</p>}
          </div>
        </aside>
      </section>

      {fileApi && saveFilePath && (
        <button type="button" className="floating-refresh" onClick={refreshSaveFile} aria-label="세이브 파일 새로고침">
          ↻
        </button>
      )}

      <section className="panel missing-panel">
        <div className="panel-head missing-head">
          <div>
            <h2>추가로 필요한 재료</h2>
            <p>{missingMaterials.length}종 재료를 {missingGroups.length}개 획득처 기준으로 정리했습니다.</p>
          </div>
          <div className="coin-summary" aria-label="코인 구매 필요량">
            {coinSummary.map((coin) => (
              <span key={coin.name}>
                <small>{coin.koreanname}</small>
                <strong>필요 x{coin.needed}</strong>
                <em>보유 x{coin.owned}</em>
              </span>
            ))}
          </div>
        </div>

        <div className="boss-grid">
          {missingGroups.map((group) => (
            <article key={group.source} className="boss-card">
              <div className="boss-card-head">
                <div>
                  <strong>{group.source}</strong>
                  <small>
                    {group.boss
                      ? `Lv. ${group.boss.level} · ${group.boss.category || group.boss.type || "Boss"}`
                      : "보스 데이터 없음"}
                  </small>
                </div>
                <span>{group.items.length}종</span>
              </div>

              <div className="boss-material-list">
                {group.items.map(({ name, count, item }) => (
                  <div key={`${group.source}-${name}`} className="missing-row">
                    <div>
                      <strong>{name}</strong>
                      <small>{item?.koreanname || item?.type || "데이터 없음"}</small>
                    </div>
                    <span>x{count}</span>
                  </div>
                ))}
              </div>
            </article>
          ))}

          {selected.length > 0 && !missingMaterials.length && (
            <p className="empty">현재 보유 재료로 제작 가능합니다.</p>
          )}
          {!selected.length && <p className="empty">목표 아이템을 추가하면 필요한 재료가 여기에 표시됩니다.</p>}
        </div>
      </section>

      <section className="panel discard-panel">
        <div className="panel-head discard-head">
          <div>
            <h2>버려도 되는 아이템</h2>
            <p>현재 목표 아이템 제작에 사용되지 않는 보유 아이템입니다.</p>
          </div>
          <span>{discardableItems.length}종</span>
        </div>

        <div className="discard-sections">
          {discardableGroups.map((group) => (
            <section key={group.key} className="discard-section">
              <div className="discard-section-head">
                <div>
                  <h3>{group.title}</h3>
                  <small>{group.label}</small>
                </div>
                <span>{group.items.length}종</span>
              </div>

              <div className="discard-grid">
                {group.items.map(({ name, count, item }) => (
                  <div key={name} className="discard-row">
                    <div>
                      <strong>{name}</strong>
                      <small>{item?.koreanname || item?.type || "데이터 없음"}</small>
                    </div>
                    <span>x{count}</span>
                  </div>
                ))}
                {!group.items.length && <p className="empty">해당 구간에 버려도 되는 아이템이 없습니다.</p>}
              </div>
            </section>
          ))}

          {selected.length > 0 && !discardableItems.length && (
            <p className="empty">현재 보유 아이템이 모두 목표 제작에 사용됩니다.</p>
          )}
          {!selected.length && <p className="empty">목표 아이템을 추가하면 비교 결과가 여기에 표시됩니다.</p>}
        </div>
      </section>

      {hoveredStats && !hoveredStats.timerId && (
        <div
          className="stats-tooltip stats-tooltip-floating"
          style={{
            left: `${hoveredStats.position.left}px`,
            top: `${hoveredStats.position.top}px`,
            width: `${hoveredStats.position.width}px`,
          }}
          onMouseEnter={keepStatsOpen}
          onMouseLeave={hideStatsImmediately}
        >
          <ItemStatsContent item={hoveredStats.item} />
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
