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

function createPreset({ id, name, saveText = "", selected = [] }) {
  return {
    id,
    name,
    saveText,
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
  let activeSection = null;

  const preloadRegex = /Preload\(\s*"([^"]*)"\s*\)/g;
  const lines = [...raw.matchAll(preloadRegex)].map((match) => match[1].trim());

  for (const line of lines) {
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

    const itemName = itemMatch[1].trim();
    sections[activeSection].push(itemName);
    inventory.set(itemName, (inventory.get(itemName) || 0) + 1);
  }

  return {
    inventory,
    sections,
    total: [...inventory.values()].reduce((sum, count) => sum + count, 0),
  };
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
    .sort((a, b) => a.name.localeCompare(b.name));
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

function calculateCoinSummary(missingMaterials) {
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
    count: summary.get(name) || 0,
  }));
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

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify({ activePresetId, presets }));
  }, [activePresetId, presets]);

  const activePreset = presets.find((preset) => preset.id === activePresetId) || presets[0];
  const saveText = activePreset?.saveText || "";
  const selected = activePreset?.selected || [];

  const updateActivePreset = (updater) => {
    setPresets((current) =>
      current.map((preset) => (preset.id === activePresetId ? { ...preset, ...updater(preset) } : preset)),
    );
  };

  const setSaveText = (value) => {
    updateActivePreset(() => ({ saveText: value }));
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
  const coinSummary = useMemo(() => calculateCoinSummary(missingMaterials), [missingMaterials]);
  const discardableItems = useMemo(
    () => calculateDiscardableItems(selected, parsedSave.inventory),
    [selected, parsedSave.inventory],
  );

  const selectedCount = selected.reduce((sum, item) => sum + item.quantity, 0);

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

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">TWRPG Helper</p>
          <h1>아이템 제작 재료 계산기</h1>
        </div>
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

      <section className="workspace">
        <aside className="panel save-panel">
          <div className="panel-head">
            <h2>세이브 파일</h2>
            <button type="button" onClick={() => setSaveText("")}>
              초기화
            </button>
          </div>
          <textarea
            value={saveText}
            onChange={(event) => setSaveText(event.target.value)}
            placeholder="PreloadFiles 내용 전체를 붙여넣으세요."
          />

          <div className="inventory-list">
            {[...parsedSave.inventory.entries()].map(([name, count]) => (
              <div key={name} className="inventory-row">
                <span>{name}</span>
                <strong>{count}</strong>
              </div>
            ))}
            {!parsedSave.total && <p className="empty">아직 파싱된 아이템이 없습니다.</p>}
          </div>
        </aside>

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
              <button key={item.id} type="button" className="item-card" onClick={() => addTarget(item)}>
                <span className="rank" style={{ color: `#${item.color || "4b5563"}` }}>
                  {item.rank === "none" ? item.type : item.rank}
                </span>
                <strong>{item.name}</strong>
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
                <article key={target.name} className={`target-card ${isTargetReady ? "target-ready" : ""}`}>
                  <div className="target-title">
                    <div>
                      <strong>{target.name}</strong>
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
                <strong>x{coin.count}</strong>
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

        <div className="discard-grid">
          {discardableItems.map(({ name, count, item }) => (
            <div key={name} className="discard-row">
              <div>
                <strong>{name}</strong>
                <small>{item?.koreanname || item?.type || "데이터 없음"}</small>
              </div>
              <span>x{count}</span>
            </div>
          ))}

          {selected.length > 0 && !discardableItems.length && (
            <p className="empty">현재 보유 아이템이 모두 목표 제작에 사용됩니다.</p>
          )}
          {!selected.length && <p className="empty">목표 아이템을 추가하면 비교 결과가 여기에 표시됩니다.</p>}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
