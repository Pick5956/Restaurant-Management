"use client";

import { useEffect, useRef } from "react";
import type { Circle, Map as LeafletMap, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";

// The QR-ordering card's map (27 ก.ย. 2569): the streets round the shop from
// OpenStreetMap, an orange pin where the shop is and the allowed radius drawn
// to scale - 150 m on the field is 150 m on the map. Tapping the map or dragging
// the pin sets the shop's position, which is how a phone opened over plain http
// (Tailscale) sets it at all: the browser refuses it "use current location"
// there. The map is decoration for the numbers, never their source of truth -
// the page keeps the fields and saves them as before.
//
// Leaflet reads `window`, so it is loaded in the effect, not at import.

const BANGKOK: [number, number] = [13.7563, 100.5018];

export default function RestaurantLocationMap({
  lat,
  lng,
  radius,
  onPick,
  className = "h-48",
  label,
}: {
  lat: number | null;
  lng: number | null;
  /** Metres. */
  radius: number | null;
  /** The shop's new position, from a tap on the map or the pin dragged. */
  onPick: (lat: number, lng: number) => void;
  /** Size of the map box. */
  className?: string;
  /** What a screen reader hears for the map. */
  label: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const circleRef = useRef<Circle | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  // The newest onPick, so the map's listeners (set up once) never call a stale one.
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  });

  const hasPoint = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng);

  // Draw the pin and the circle where the numbers say, and frame them.
  const place = (fit: boolean) => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (!hasPoint) {
      markerRef.current?.remove();
      circleRef.current?.remove();
      markerRef.current = null;
      circleRef.current = null;
      return;
    }
    const point: [number, number] = [lat as number, lng as number];
    if (!markerRef.current) {
      markerRef.current = L.marker(point, {
        draggable: true,
        keyboard: false,
        // A plain orange dot drawn in CSS: Leaflet's default pin is an image
        // the bundler does not ship.
        icon: L.divIcon({
          className: "",
          html: '<span style="display:block;width:20px;height:20px;border-radius:9999px;background:#c53c00;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
      }).addTo(map);
      markerRef.current.on("dragend", () => {
        const at = markerRef.current?.getLatLng();
        if (at) pickRef.current(Number(at.lat.toFixed(6)), Number(at.lng.toFixed(6)));
      });
    } else {
      markerRef.current.setLatLng(point);
    }
    const metres = radius && radius > 0 ? radius : 0;
    if (metres) {
      if (!circleRef.current) {
        circleRef.current = L.circle(point, { radius: metres, color: "#c53c00", weight: 2, fillColor: "#c53c00", fillOpacity: 0.12, interactive: false }).addTo(map);
      } else {
        circleRef.current.setLatLng(point).setRadius(metres);
      }
    } else {
      circleRef.current?.remove();
      circleRef.current = null;
    }
    if (fit) {
      if (circleRef.current) map.fitBounds(circleRef.current.getBounds(), { padding: [24, 24], maxZoom: 18 });
      else map.setView(point, 17);
    }
  };

  // Build the map once.
  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !boxRef.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(boxRef.current, {
        center: hasPoint ? [lat as number, lng as number] : BANGKOK,
        zoom: hasPoint ? 16 : 11,
        zoomControl: true,
        attributionControl: true,
        // The page scrolls under a finger; the map pans with two, or after a tap.
        scrollWheelZoom: false,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      }).addTo(map);
      map.attributionControl.setPrefix(false);
      map.on("click", (event) => pickRef.current(Number(event.latlng.lat.toFixed(6)), Number(event.latlng.lng.toFixed(6))));
      mapRef.current = map;
      place(true);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow the numbers: a new position re-frames, a new radius re-frames too so
  // the whole circle stays in view.
  useEffect(() => {
    place(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, radius]);

  // The settings window keeps every section mounted and hides the others, so
  // a map can be built in a box with no size. Leaflet draws grey until it is
  // told the box changed, and a view framed at zero size is wrong: re-measure,
  // and re-frame the first time the box actually shows.
  const placeRef = useRef(place);
  useEffect(() => {
    placeRef.current = place;
  });
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    let shown = box.clientWidth > 0;
    const observer = new ResizeObserver(() => {
      mapRef.current?.invalidateSize();
      const nowShown = box.clientWidth > 0;
      if (nowShown && !shown) placeRef.current(true);
      shown = nowShown;
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    // isolate: Leaflet's panes sit at z-index 400+, which would draw them over
    // the settings window's own bar when the card scrolls under it.
    <div ref={boxRef} role="application" aria-label={label} className={`relative isolate z-0 overflow-hidden rounded-2xl bg-gray-100 dark:bg-gray-800 ${className}`} />
  );
}
