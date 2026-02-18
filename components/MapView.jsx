"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import { decode } from "@here/flexpolyline";
import L from "leaflet";

const COLORS = ["#4f46e5", "#16a34a", "#dc2626", "#d97706", "#0891b2", "#7c3aed", "#db2777", "#ea580c"];

// Leaflet のデフォルトアイコン修正（Next.js/webpack 環境用）
function fixLeafletIcons() {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

function makeColoredIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

// 全ルートが収まるよう自動ズーム
function FitBounds({ allPositions }) {
  const map = useMap();
  useEffect(() => {
    if (!allPositions.length) return;
    const bounds = L.latLngBounds(allPositions);
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, allPositions]);
  return null;
}

export default function MapView({ results }) {
  useEffect(() => { fixLeafletIcons(); }, []);

  const routes = results
    .filter((r) => r._polyline?.length > 0)
    .map((r, i) => {
      const positions = r._polyline.flatMap((encoded) => {
        try {
          return decode(encoded).polyline.map(([lat, lng]) => [lat, lng]);
        } catch {
          return [];
        }
      });
      return { id: r.id, positions, color: COLORS[i % COLORS.length] };
    })
    .filter((r) => r.positions.length > 0);

  const allPositions = routes.flatMap((r) => r.positions);

  if (!routes.length) return null;

  return (
    <MapContainer
      center={[36.5, 137.5]}
      zoom={6}
      style={{ height: 450, width: "100%", borderRadius: 8 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {routes.map((r) => (
        <Polyline
          key={r.id}
          positions={r.positions}
          color={r.color}
          weight={4}
          opacity={0.85}
        />
      ))}
      {routes.flatMap((r) => [
        <Marker key={`o-${r.id}`} position={r.positions[0]} icon={makeColoredIcon(r.color)}>
          <Popup>ID: {r.id} 出発地</Popup>
        </Marker>,
        <Marker key={`d-${r.id}`} position={r.positions[r.positions.length - 1]} icon={makeColoredIcon(r.color)}>
          <Popup>ID: {r.id} 目的地</Popup>
        </Marker>,
      ])}
      <FitBounds allPositions={allPositions} />
    </MapContainer>
  );
}
