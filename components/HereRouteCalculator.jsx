"use client";

import { useState, useRef } from "react";
import dynamic from "next/dynamic";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

// ─── HERE Routing API v8 ────────────────────────────────────────────────────
const HERE_ROUTING_BASE = "https://router.hereapi.com/v8/routes";

async function fetchRoute(apiKey, originLat, originLng, destLat, destLng) {
  const url = new URL(HERE_ROUTING_BASE);
  url.searchParams.set("transportMode", "car");
  url.searchParams.set("routingMode", "fast");
  url.searchParams.set("departureTime", "any");
  url.searchParams.set("origin", `${originLat},${originLng}`);
  url.searchParams.set("destination", `${destLat},${destLng}`);
  url.searchParams.set("return", "summary,tolls,polyline,actions,instructions");
  url.searchParams.set("lang", "ja");
  url.searchParams.set("apikey", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

// 有料道路料金合計（円）を取得 — 現金料金を優先、なければ最初のfareを使用
function extractTollCost(data) {
  try {
    let total = 0;
    data.routes[0].sections.forEach((section) => {
      (section.tolls || []).forEach((toll) => {
        const fares = toll.fares || [];
        const cashFare = fares.find((fare) =>
          (fare.paymentMethods || []).includes("cash")
        );
        const fare = cashFare ?? fares[0];
        if (fare) total += fare.price?.value ?? 0;
      });
    });
    return total;
  } catch {
    return 0;
  }
}

// ─── CSV ユーティリティ ──────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const values = line.split(",").map((v) => v.trim());
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = values[i] ?? "";
      });
      return obj;
    });
}

function toCSVString(rows) {
  if (!rows.length) return "";
  // _ プレフィックスのキー（内部データ）はCSVに含めない
  const headers = Object.keys(rows[0]).filter((k) => !k.startsWith("_"));
  const escape = (v) =>
    String(v).includes(",") ? `"${v}"` : String(v);
  return [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((h) => escape(row[h] ?? "")).join(",")
    ),
  ].join("\n");
}

function downloadCSV(content, filename) {
  const blob = new Blob(["\uFEFF" + content], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const TEMPLATE_CSV =
  "id,origin_lat,origin_lng,dest_lat,dest_lng\n" +
  "1,35.6812,139.7671,34.6937,135.5023\n" +
  "2,35.6812,139.7671,35.0116,135.7681\n" +
  "3,34.6937,135.5023,33.5904,130.4017";

const ROUTE_COLORS = ["#4f46e5", "#16a34a", "#dc2626", "#d97706", "#0891b2", "#7c3aed", "#db2777", "#ea580c"];

// アクション種別のアイコンとラベル
const ACTION_META = {
  depart:   { icon: "🚗", label: "出発",   bg: "#eff6ff", border: "#bfdbfe" },
  arrive:   { icon: "🏁", label: "到着",   bg: "#f0fdf4", border: "#bbf7d0" },
  turn:     { icon: "↩",  label: "曲がる", bg: "#fff",    border: "#e5e7eb" },
  keep:     { icon: "↗",  label: "進む",   bg: "#fff",    border: "#e5e7eb" },
  continue: { icon: "↑",  label: "直進",   bg: "#fff",    border: "#e5e7eb" },
  exit:     { icon: "⬇",  label: "降りる", bg: "#fefce8", border: "#fef08a" },
  ramp:     { icon: "↗",  label: "ランプ", bg: "#fefce8", border: "#fef08a" },
  ferry:    { icon: "⛴",  label: "フェリー", bg: "#eff6ff", border: "#bfdbfe" },
};

function formatDist(m) {
  if (m == null) return "";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

function formatDur(s) {
  if (s == null || s === 0) return "";
  const min = Math.round(s / 60);
  return min < 1 ? "< 1分" : `${min}分`;
}

// ─── スタイル定数 ───────────────────────────────────────────────────────────
const S = {
  page: {
    fontFamily: "'Inter','Hiragino Sans','Meiryo',sans-serif",
    maxWidth: 980,
    margin: "36px auto",
    padding: "0 20px",
    color: "#111827",
  },
  card: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: "22px 26px",
    marginBottom: 20,
    boxShadow: "0 1px 4px rgba(0,0,0,.06)",
  },
  stepBadge: {
    display: "inline-block",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1.5,
    color: "#6366f1",
    background: "#eef2ff",
    borderRadius: 4,
    padding: "2px 8px",
    marginBottom: 10,
  },
  label: {
    display: "block",
    fontWeight: 600,
    fontSize: 14,
    marginBottom: 7,
    color: "#374151",
  },
  input: {
    width: "100%",
    padding: "9px 13px",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontSize: 14,
    boxSizing: "border-box",
    outline: "none",
    transition: "border .15s",
  },
  btnPrimary: {
    padding: "10px 26px",
    background: "#4f46e5",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnDisabled: {
    padding: "10px 26px",
    background: "#9ca3af",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "not-allowed",
  },
  btnGray: {
    padding: "9px 18px",
    background: "#f3f4f6",
    color: "#374151",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  },
  btnGreen: {
    padding: "9px 20px",
    background: "#16a34a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  th: {
    padding: "10px 14px",
    border: "1px solid #e5e7eb",
    textAlign: "left",
    fontWeight: 600,
    fontSize: 12,
    whiteSpace: "nowrap",
    color: "#374151",
    background: "#f9fafb",
  },
  td: {
    padding: "9px 14px",
    border: "1px solid #e5e7eb",
    fontSize: 13,
  },
};

// ─── コンポーネント本体 ─────────────────────────────────────────────────────
export default function HereRouteCalculator() {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [inputRows, setInputRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [openActionId, setOpenActionId] = useState(null);
  const fileRef = useRef();

  // CSVファイル読み込み
  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCSV(ev.target.result);
        if (!rows.length) throw new Error("データが空です");
        const required = ["origin_lat", "origin_lng", "dest_lat", "dest_lng"];
        const missing = required.filter((k) => !(k in rows[0]));
        if (missing.length)
          throw new Error(`列が不足しています: ${missing.join(", ")}`);
        setInputRows(rows);
        setResults([]);
        setError("");
      } catch (err) {
        setError("CSVの解析に失敗しました: " + err.message);
        setInputRows([]);
      }
    };
    reader.readAsText(file, "UTF-8");
  };

  // HERE API 一括呼び出し
  const handleCalculate = async () => {
    if (!apiKey.trim()) {
      setError("APIキーを入力してください");
      return;
    }
    if (!inputRows.length) {
      setError("CSVをアップロードしてください");
      return;
    }

    setLoading(true);
    setError("");
    setProgress({ done: 0, total: inputRows.length });

    const out = [];

    for (let i = 0; i < inputRows.length; i++) {
      const row = inputRows[i];
      const { origin_lat, origin_lng, dest_lat, dest_lng } = row;

      try {
        if (!origin_lat || !origin_lng || !dest_lat || !dest_lng)
          throw new Error("座標が不足しています");

        const data = await fetchRoute(
          apiKey,
          origin_lat,
          origin_lng,
          dest_lat,
          dest_lng
        );

        const sections = data.routes[0].sections;
        const totalLength = sections.reduce((sum, s) => sum + (s.summary?.length ?? 0), 0);
        const totalDuration = sections.reduce((sum, s) => sum + (s.summary?.duration ?? 0), 0);
        const distKm = (totalLength / 1000).toFixed(2);
        const durMin = Math.round(totalDuration / 60);
        const toll = extractTollCost(data);

        // 全セクションのpolylineを配列で保持
        const polyline = sections.map((s) => s.polyline).filter(Boolean);
        // 全セクションのactionsを結合（return=instructions により instruction テキストが含まれる）
        const actions = sections.flatMap((s) => s.actions ?? []);
        // 料金区間ごとのETC内訳（料金所名含む）
        const tolls = sections.flatMap((s) => s.tolls ?? []).map((t) => {
          const fares = t.fares ?? [];
          const etcFare = fares.find((f) => (f.paymentMethods ?? []).includes("cash")) ?? fares[0];
          const loc = t.tollCollectionLocations ?? {};
          return {
            system: t.tollSystem ?? t.countryCode ?? "有料区間",
            entry: loc.entry?.name ?? null,
            exit: loc.exit?.name ?? null,
            price: etcFare?.price?.value ?? 0,
          };
        }).filter((t) => t.price > 0);

        out.push({
          id: row.id ?? i + 1,
          出発地緯度: origin_lat,
          出発地経度: origin_lng,
          目的地緯度: dest_lat,
          目的地経度: dest_lng,
          距離_km: distKm,
          所要時間_分: durMin,
          有料道路料金_円: toll,
          ステータス: "成功",
          _polyline: polyline,
          _actions: actions,
          _tolls: tolls,
        });
      } catch (err) {
        out.push({
          id: row.id ?? i + 1,
          出発地緯度: origin_lat,
          出発地経度: origin_lng,
          目的地緯度: dest_lat,
          目的地経度: dest_lng,
          距離_km: "-",
          所要時間_分: "-",
          有料道路料金_円: "-",
          ステータス: `エラー: ${err.message}`,
          _polyline: null,
          _actions: [],
        });
      }

      setProgress({ done: i + 1, total: inputRows.length });
      if (i < inputRows.length - 1)
        await new Promise((r) => setTimeout(r, 200));
    }

    setResults(out);
    setLoading(false);
  };

  const handleExport = () => {
    downloadCSV(toCSVString(results), "route_results.csv");
  };

  const successCount = results.filter((r) => r.ステータス === "成功").length;
  const errorCount = results.length - successCount;
  const pct = progress.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <div style={S.page}>
      {/* ヘッダー */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          HERE API ルート一括計算ツール
        </h1>
        <p style={{ color: "#6b7280", marginTop: 5, fontSize: 14 }}>
          CSVで複数の座標ペアをアップロードし、距離・所要時間・有料道路料金を一括取得してCSV出力します
        </p>
      </div>

      {/* STEP 1: API キー */}
      <div style={S.card}>
        <span style={S.stepBadge}>STEP 1</span>
        <label style={S.label}>HERE API キー</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="ここにAPIキーを貼り付け"
            style={{ ...S.input, flex: 1 }}
          />
          <button
            onClick={() => setShowKey((v) => !v)}
            style={S.btnGray}
          >
            {showKey ? "隠す" : "表示"}
          </button>
        </div>
        <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 6 }}>
          APIキーは{" "}
          <a
            href="https://developer.here.com/"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#6366f1" }}
          >
            HERE Developer Portal
          </a>{" "}
          で取得できます
        </p>
      </div>

      {/* STEP 2: CSV アップロード */}
      <div style={S.card}>
        <span style={S.stepBadge}>STEP 2</span>
        <label style={S.label}>座標CSVをアップロード</label>
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              display: "inline-block",
              padding: "9px 18px",
              background: "#f3f4f6",
              border: "1px solid #d1d5db",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            📂 ファイルを選択
            <input
              type="file"
              accept=".csv"
              ref={fileRef}
              onChange={handleFile}
              style={{ display: "none" }}
            />
          </label>
          <span style={{ fontSize: 14, color: "#6b7280" }}>
            {fileName || "未選択"}
          </span>
          <button
            onClick={() => downloadCSV(TEMPLATE_CSV, "template.csv")}
            style={S.btnGray}
          >
            📥 テンプレートDL
          </button>
        </div>
        <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
          必須列:{" "}
          <code
            style={{
              background: "#f3f4f6",
              padding: "1px 5px",
              borderRadius: 4,
            }}
          >
            id, origin_lat, origin_lng, dest_lat, dest_lng
          </code>
        </p>
        {inputRows.length > 0 && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 14px",
              background: "#eff6ff",
              borderRadius: 6,
              fontSize: 13,
              color: "#1d4ed8",
            }}
          >
            ✅ {inputRows.length} 件のルートを読み込みました
          </div>
        )}
      </div>

      {/* エラー表示 */}
      {error && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: 8,
            padding: "10px 16px",
            marginBottom: 16,
            color: "#b91c1c",
            fontSize: 14,
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* STEP 3: 計算実行 */}
      <div
        style={{ marginBottom: 28, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}
      >
        <button
          onClick={handleCalculate}
          disabled={loading}
          style={loading ? S.btnDisabled : S.btnPrimary}
        >
          {loading
            ? `⏳ 計算中… (${progress.done} / ${progress.total})`
            : "🚗  ルートを計算する"}
        </button>
        {loading && (
          <div style={{ flex: 1, minWidth: 200 }}>
            <div
              style={{
                height: 8,
                background: "#e5e7eb",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: "#4f46e5",
                  transition: "width .3s",
                }}
              />
            </div>
            <p style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
              {pct}% 完了
            </p>
          </div>
        )}
      </div>

      {/* 結果テーブル */}
      {results.length > 0 && (
        <div style={S.card}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <div>
              <span style={{ fontWeight: 700, fontSize: 16 }}>
                計算結果
              </span>
              <span
                style={{ marginLeft: 12, fontSize: 13, color: "#16a34a" }}
              >
                ✅ 成功 {successCount} 件
              </span>
              {errorCount > 0 && (
                <span
                  style={{ marginLeft: 8, fontSize: 13, color: "#b91c1c" }}
                >
                  ❌ エラー {errorCount} 件
                </span>
              )}
            </div>
            <button onClick={handleExport} style={S.btnGreen}>
              📤 CSVエクスポート
            </button>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {[
                    "ID",
                    "出発地 (緯度)",
                    "出発地 (経度)",
                    "目的地 (緯度)",
                    "目的地 (経度)",
                    "距離 (km)",
                    "所要時間 (分)",
                    "有料道路料金 (円)",
                    "ステータス",
                  ].map((h) => (
                    <th key={h} style={S.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr
                    key={i}
                    style={{ background: i % 2 === 0 ? "#fff" : "#f9fafb" }}
                  >
                    <td style={S.td}>
                      <span
                        style={{
                          display: "inline-block",
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: ROUTE_COLORS[i % ROUTE_COLORS.length],
                          marginRight: 6,
                          verticalAlign: "middle",
                        }}
                      />
                      {r.id}
                    </td>
                    <td style={S.td}>{r.出発地緯度}</td>
                    <td style={S.td}>{r.出発地経度}</td>
                    <td style={S.td}>{r.目的地緯度}</td>
                    <td style={S.td}>{r.目的地経度}</td>
                    <td style={{ ...S.td, textAlign: "right" }}>
                      {r.距離_km}
                    </td>
                    <td style={{ ...S.td, textAlign: "right" }}>
                      {r.所要時間_分}
                    </td>
                    <td style={{ ...S.td, textAlign: "right" }}>
                      {r.有料道路料金_円 !== "-"
                        ? `¥${Number(r.有料道路料金_円).toLocaleString()}`
                        : "-"}
                    </td>
                    <td
                      style={{
                        ...S.td,
                        color:
                          r.ステータス === "成功" ? "#16a34a" : "#b91c1c",
                        fontWeight: 500,
                      }}
                    >
                      {r.ステータス}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 地図 */}
      {results.some((r) => r._polyline?.length > 0) && (
        <div style={S.card}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>🗺 ルート地図</span>
          <div style={{ marginTop: 14 }}>
            <MapView results={results} />
          </div>
        </div>
      )}

      {/* 経路詳細アコーディオン */}
      {results.some((r) => r._actions?.length > 0) && (
        <div style={S.card}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>📋 経路詳細</span>
          <div style={{ marginTop: 14 }}>
            {results
              .filter((r) => r._actions?.length > 0)
              .map((r) => {
                const color = ROUTE_COLORS[results.indexOf(r) % ROUTE_COLORS.length];
                const isOpen = openActionId === r.id;
                return (
                  <div key={r.id} style={{ marginBottom: 8 }}>
                    {/* アコーディオンヘッダー */}
                    <button
                      onClick={() => setOpenActionId(isOpen ? null : r.id)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 14px",
                        background: "#f9fafb",
                        border: "1px solid #e5e7eb",
                        borderRadius: isOpen ? "8px 8px 0 0" : 8,
                        cursor: "pointer",
                        fontSize: 14,
                        fontWeight: 600,
                        textAlign: "left",
                      }}
                    >
                      <span style={{
                        display: "inline-block", width: 12, height: 12,
                        borderRadius: "50%", background: color, flexShrink: 0,
                      }} />
                      ID: {r.id}　{r.距離_km} km　{r.所要時間_分}分
                      <span style={{ color: "#6b7280", fontWeight: 400, fontSize: 13 }}>
                        ¥{Number(r.有料道路料金_円).toLocaleString()} (現金)
                      </span>
                      <span style={{ marginLeft: "auto", color: "#6b7280", fontWeight: 400 }}>
                        {isOpen ? "▲ 閉じる" : "▼ 詳細を見る"}
                      </span>
                    </button>

                    {/* タイムライン */}
                    {isOpen && (
                      <div style={{
                        border: "1px solid #e5e7eb", borderTop: "none",
                        borderRadius: "0 0 8px 8px", padding: "16px 20px",
                      }}>
                        {/* 料金内訳 */}
                        {r._tolls?.length > 0 && (
                          <div style={{
                            marginBottom: 16, padding: "10px 14px",
                            background: "#fefce8", border: "1px solid #fef08a",
                            borderRadius: 8, fontSize: 13,
                          }}>
                            <div style={{ fontWeight: 600, marginBottom: 6 }}>💴 現金料金内訳</div>
                            {r._tolls.map((t, idx) => (
                              <div key={idx} style={{ padding: "4px 0", borderBottom: "1px dashed #fef08a" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", color: "#374151" }}>
                                  <span style={{ fontWeight: 600 }}>{t.system}</span>
                                  <span style={{ fontWeight: 700 }}>¥{t.price.toLocaleString()}</span>
                                </div>
                                {(t.entry || t.exit) && (
                                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                                    {t.entry && <span>🔵 入口: {t.entry}</span>}
                                    {t.entry && t.exit && <span style={{ margin: "0 6px" }}>→</span>}
                                    {t.exit && <span>🔴 出口: {t.exit}</span>}
                                  </div>
                                )}
                              </div>
                            ))}
                            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #fef08a", marginTop: 6, paddingTop: 6, fontWeight: 700 }}>
                              <span>合計</span>
                              <span>¥{Number(r.有料道路料金_円).toLocaleString()}</span>
                            </div>
                          </div>
                        )}
                        {r._actions.map((a, idx) => {
                          const meta = ACTION_META[a.action] ?? { icon: "•", label: a.action, bg: "#fff", border: "#e5e7eb" };
                          const isLast = idx === r._actions.length - 1;
                          return (
                            <div key={idx} style={{ display: "flex", gap: 12 }}>
                              {/* 左列：アイコン＋縦線 */}
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 36, flexShrink: 0 }}>
                                <div style={{
                                  width: 32, height: 32, borderRadius: "50%",
                                  background: meta.bg, border: `1.5px solid ${meta.border}`,
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: 14, flexShrink: 0,
                                }}>
                                  {meta.icon}
                                </div>
                                {!isLast && (
                                  <div style={{ width: 2, flex: 1, minHeight: 18, background: "#e5e7eb", margin: "3px 0" }} />
                                )}
                              </div>

                              {/* 右列：テキスト */}
                              <div style={{ paddingBottom: isLast ? 0 : 14, flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", lineHeight: 1.4 }}>
                                  {a.instruction || meta.label}
                                </div>
                                {(a.length > 0 || a.duration > 0) && (
                                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                                    {formatDist(a.length)}
                                    {a.length > 0 && a.duration > 0 && "　"}
                                    {formatDur(a.duration)}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
