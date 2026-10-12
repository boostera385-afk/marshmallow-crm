import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import MapFilterControls from "@/components/map/MapFilterControls";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MapPin, Search, X, Contact, User, Loader2, Wrench } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { TechnicianRecord } from "@/components/technicians/TechnicianDialog";
import { TechnicianNameBadges } from "@/components/technicians/TechnicianNameCell";
import { buildTechnicianNameCounts } from "@/lib/technician-names";
import { TechnicianDetailsContent } from "@/components/map/TechnicianDetailsContent";
import { fetchAllTechnicians, TECHNICIANS_QUERY_KEY } from "@/lib/technicians";
import { haversineMiles, isValidLatLng, LatLng, geocodeArea, reverseGeocodeCity } from "@/lib/geo";
import { resolveZip, lookupZipCentroidSync, lookupAreaCentroidSync, preloadZipDataset, ZipCentroid } from "@/lib/zipCentroids";
import { STATUS_LABELS } from "@/lib/constants";
import { useIsMobile } from "@/hooks/use-mobile";
import type { LeadStatus } from "@/types";
import { toast } from "sonner";


const RADIUS_MILES = 20;
const RADIUS_METERS = RADIUS_MILES * 1609.344;

/** A user-drawn "good coverage" circle on the map. */
interface CoverageArea {
  id: string;
  center: LatLng;
  radiusMiles: number;
  name: string;
  isActive: boolean;
}

interface CoverageAreaRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_miles: number;
  is_active: boolean;
}

function coverageAreaFromRow(row: CoverageAreaRow): CoverageArea {
  return {
    id: row.id,
    name: row.name ?? "",
    center: { latitude: row.latitude, longitude: row.longitude },
    radiusMiles: row.radius_miles,
    isActive: row.is_active,
  };
}
const US_STATES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",DC:"District of Columbia",
};
const STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]),
);

interface UrgentLead {
  id: string;
  job_id: string;
  customer_name: string;
  customer_phone: string;
  address: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  service_type: string;
  status: LeadStatus;
  latitude: number | null;
  longitude: number | null;
}

interface MappedLead extends UrgentLead {
  coords: LatLng;
  zip: string;
  zipCity: string;
  zipState: string;
}

interface MappedTech extends TechnicianRecord {
  coords: LatLng;
}

interface SearchableTech extends TechnicianRecord {
  coords: LatLng | null;
  locationUnavailable: boolean;
}

// A row in the unified search dropdown.
type OmniItem =
  | { kind: "tech"; tech: SearchableTech }
  | { kind: "customer"; lead: MappedLead }
  | { kind: "location" };

type CanvasPinKind = "lead" | "tech";

interface CanvasPin {
  id: string;
  kind: CanvasPinKind;
  lat: number;
  lng: number;
  selected?: boolean;
}

interface CanvasHitTarget extends CanvasPin {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// Tech pins whose projected positions land within this many screen pixels of
// each other collapse into one cluster point. Techs in a city share one ZIP
// centroid, so without this they stack and hide each other.
const CLUSTER_RADIUS_PX = 26;

// At/above this zoom, multi-member clusters fan out automatically (no click
// needed) — the map is close enough that showing every tech is readable.
const AUTO_SPIDER_ZOOM = 12;

interface ProjectedCluster {
  x: number;
  y: number;
  members: CanvasPin[];
}

interface ClusterHitTarget {
  x: number;
  y: number;
  r: number;
  members: CanvasPin[];
}

// Pixel offsets (from the cluster centre) for the fanned-out members. Small
// clusters sit on one ring; larger ones spill onto additional concentric rings
// so nothing overlaps, which keeps even ~40 techs in a city readable.
function spiderOffsets(count: number): Array<{ dx: number; dy: number }> {
  const offsets: Array<{ dx: number; dy: number }> = [];
  const baseRadius = 46;
  const ringGap = 34;
  const minSpacing = 34;
  let placed = 0;
  let ring = 0;
  while (placed < count) {
    const radius = baseRadius + ring * ringGap;
    const capacity = Math.max(1, Math.floor((2 * Math.PI * radius) / minSpacing));
    const inRing = Math.min(capacity, count - placed);
    const angleStart = -Math.PI / 2 + (ring % 2 === 1 ? Math.PI / inRing : 0);
    for (let i = 0; i < inRing; i += 1) {
      const a = angleStart + (2 * Math.PI * i) / inRing;
      offsets.push({ dx: Math.cos(a) * radius, dy: Math.sin(a) * radius });
    }
    placed += inRing;
    ring += 1;
  }
  return offsets;
}

class MapPinCanvasLayer extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private map: L.Map | null = null;
  private topLeft = L.point(0, 0);
  private pins: CanvasPin[] = [];
  private leadHitTargets: CanvasHitTarget[] = [];
  private techHitTargets: CanvasHitTarget[] = [];
  private clusterHitTargets: ClusterHitTarget[] = [];
  // When a cluster is expanded ("spiderfied"), its member ids live here and the
  // members are fanned out around the cluster point instead of drawn as a badge.
  private spiderIds: Set<string> | null = null;
  private resetFrame: number | null = null;
  private redrawFrame: number | null = null;
  private hoverFrame: number | null = null;
  private lastMouseMoveEvent: MouseEvent | null = null;
  private isMoving = false;
  private canvasCssWidth = 0;
  private canvasCssHeight = 0;
  private canvasScale = 0;

  constructor(
    private readonly onTechClick: (id: string, latlng: L.LatLng) => void,
    private readonly onLeadClick: (id: string, latlng: L.LatLng) => void,
    private readonly getTechTooltip: (id: string) => string,
  ) {
    super();
  }

  onAdd(map: L.Map): this {
    this.map = map;
    this.canvas = L.DomUtil.create("canvas", "marshmallow-map-pin-canvas");
    this.canvas.style.position = "absolute";
    this.canvas.style.zIndex = "620";
    this.canvas.style.pointerEvents = "auto";
    this.canvas.addEventListener("click", this.handleClick);
    this.canvas.addEventListener("mousemove", this.handleMouseMove);
    this.canvas.addEventListener("mouseleave", this.handleMouseLeave);
    const pane = map.getPane("marshmallow-tech-pins") ?? map.getPanes().overlayPane;
    pane.appendChild(this.canvas);
    map.on("movestart zoomstart", this.handleMoveStart, this);
    map.on("moveend zoomend", this.handleMoveEnd, this);
    map.on("resize viewreset", this.scheduleReset, this);
    map.on("zoomstart", this.handleZoomStart, this);
    this.reset();
    return this;
  }

  onRemove(map: L.Map): this {
    map.off("movestart zoomstart", this.handleMoveStart, this);
    map.off("moveend zoomend", this.handleMoveEnd, this);
    map.off("zoomstart", this.handleZoomStart, this);
    map.off("resize viewreset", this.scheduleReset, this);
    this.cancelFrames();
    if (this.canvas) {
      this.canvas.removeEventListener("click", this.handleClick);
      this.canvas.removeEventListener("mousemove", this.handleMouseMove);
      this.canvas.removeEventListener("mouseleave", this.handleMouseLeave);
      L.DomUtil.remove(this.canvas);
    }
    this.canvas = null;
    this.map = null;
    this.leadHitTargets = [];
    this.techHitTargets = [];
    this.clusterHitTargets = [];
    this.spiderIds = null;
    this.lastMouseMoveEvent = null;
    return this;
  }

  setPins(pins: CanvasPin[]) {
    this.pins = pins;
    this.scheduleRedraw();
  }

  // Collapse any open spider when the zoom changes: the grouping can change, so
  // the fanned-out positions would no longer line up with a real cluster.
  private handleZoomStart = () => {
    if (this.spiderIds) this.spiderIds = null;
  };

  private cancelFrames() {
    if (this.resetFrame !== null) window.cancelAnimationFrame(this.resetFrame);
    if (this.redrawFrame !== null) window.cancelAnimationFrame(this.redrawFrame);
    if (this.hoverFrame !== null) window.cancelAnimationFrame(this.hoverFrame);
    this.resetFrame = null;
    this.redrawFrame = null;
    this.hoverFrame = null;
  }

  private scheduleReset = () => {
    if (this.resetFrame !== null) return;
    this.resetFrame = window.requestAnimationFrame(() => {
      this.resetFrame = null;
      this.reset();
    });
  };

  private scheduleRedraw = () => {
    if (this.redrawFrame !== null) return;
    this.redrawFrame = window.requestAnimationFrame(() => {
      this.redrawFrame = null;
      this.redraw();
    });
  };

  private handleMoveStart = () => {
    this.isMoving = true;
    if (!this.canvas) return;
    this.canvas.style.cursor = "";
    this.canvas.title = "";
  };

  private handleMoveEnd = () => {
    this.isMoving = false;
    this.scheduleReset();
  };

  private reset = () => {
    if (!this.map || !this.canvas) return;
    const size = this.map.getSize();
    this.topLeft = this.map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this.canvas, this.topLeft);
    const scale = window.devicePixelRatio || 1;
    const nextPixelWidth = Math.max(1, Math.round(size.x * scale));
    const nextPixelHeight = Math.max(1, Math.round(size.y * scale));
    if (
      this.canvas.width !== nextPixelWidth
      || this.canvas.height !== nextPixelHeight
      || this.canvasScale !== scale
    ) {
      this.canvas.width = nextPixelWidth;
      this.canvas.height = nextPixelHeight;
      this.canvasScale = scale;
    }
    if (this.canvasCssWidth !== size.x) {
      this.canvas.style.width = `${size.x}px`;
      this.canvasCssWidth = size.x;
    }
    if (this.canvasCssHeight !== size.y) {
      this.canvas.style.height = `${size.y}px`;
      this.canvasCssHeight = size.y;
    }
    const ctx = this.canvas.getContext("2d");
    if (ctx) ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this.redraw();
  };

  private redraw() {
    if (!this.map || !this.canvas) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const size = this.map.getSize();
    ctx.clearRect(0, 0, size.x, size.y);
    this.leadHitTargets = [];
    this.techHitTargets = [];
    this.clusterHitTargets = [];

    // Leads keep their existing per-pin rendering (they already carry jitter).
    for (const pin of this.pins) {
      if (pin.kind === "lead") this.drawPin(ctx, pin, "#ef4444", 30);
    }

    // Techs cluster: a stack of techs on one point becomes a single cluster
    // point that fans its members out in a ring when clicked (spiderfied).
    const autoExpand = (this.map.getZoom() ?? 0) >= AUTO_SPIDER_ZOOM;
    const techClusters = this.clusterPins(this.pins.filter((p) => p.kind === "tech"));
    for (const cluster of techClusters) {
      const manuallyOpen = this.spiderIds !== null
        && cluster.members.length === this.spiderIds.size
        && cluster.members.every((m) => this.spiderIds!.has(m.id));

      if (cluster.members.length === 1) {
        const pin = cluster.members[0];
        this.drawPin(ctx, pin, pin.selected ? "#2563eb" : "#3b82f6", pin.selected ? 34 : 30);
      } else if (manuallyOpen || autoExpand) {
        // Fanned out either by a click or automatically once zoomed in close.
        this.drawSpider(ctx, cluster);
      } else {
        this.drawClusterBadge(ctx, cluster);
      }
    }
  }

  // Greedy pixel-space clustering with a small spatial grid so it stays near
  // O(n): each pin joins the first nearby cluster, otherwise starts a new one.
  private clusterPins(pins: CanvasPin[]): ProjectedCluster[] {
    if (!this.map) return [];
    const acc: Array<{ sumX: number; sumY: number; members: CanvasPin[] }> = [];
    const grid = new Map<string, typeof acc>();
    const cell = CLUSTER_RADIUS_PX;
    const r2 = CLUSTER_RADIUS_PX * CLUSTER_RADIUS_PX;

    for (const pin of pins) {
      const p = this.map.latLngToLayerPoint([pin.lat, pin.lng]).subtract(this.topLeft);
      const gx = Math.floor(p.x / cell);
      const gy = Math.floor(p.y / cell);
      let placed: { sumX: number; sumY: number; members: CanvasPin[] } | null = null;

      for (let dx = -1; dx <= 1 && !placed; dx += 1) {
        for (let dy = -1; dy <= 1 && !placed; dy += 1) {
          const bucket = grid.get(`${gx + dx},${gy + dy}`);
          if (!bucket) continue;
          for (const c of bucket) {
            const cx = c.sumX / c.members.length;
            const cy = c.sumY / c.members.length;
            const ddx = cx - p.x;
            const ddy = cy - p.y;
            if (ddx * ddx + ddy * ddy <= r2) { placed = c; break; }
          }
        }
      }

      if (placed) {
        placed.members.push(pin);
        placed.sumX += p.x;
        placed.sumY += p.y;
      } else {
        const created = { sumX: p.x, sumY: p.y, members: [pin] };
        acc.push(created);
        const key = `${gx},${gy}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(created);
        else grid.set(key, [created]);
      }
    }

    return acc.map((c) => ({ x: c.sumX / c.members.length, y: c.sumY / c.members.length, members: c.members }));
  }

  private drawPin(ctx: CanvasRenderingContext2D, pin: CanvasPin, fill: string, size: number) {
    if (!this.map) return;
    const point = this.map.latLngToLayerPoint([pin.lat, pin.lng]).subtract(this.topLeft);
    this.drawPinAt(ctx, point.x, point.y, pin, fill, size);
  }

  // Draws the teardrop pin at an explicit pixel position and registers its hit
  // target there, so spider legs can place a pin away from its own lat/lng.
  private drawPinAt(ctx: CanvasRenderingContext2D, x: number, y: number, pin: CanvasPin, fill: string, size: number) {
    const halfWidth = size * 0.42;
    const target: CanvasHitTarget = {
      ...pin,
      minX: x - halfWidth,
      maxX: x + halfWidth,
      minY: y - size,
      maxY: y + 3,
    };
    if (pin.kind === "tech") this.techHitTargets.push(target);
    else this.leadHitTargets.push(target);

    const scale = size / 32;
    ctx.save();
    ctx.translate(x - 12 * scale, y - 31.25 * scale);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.moveTo(12, 0.75);
    ctx.bezierCurveTo(5.65, 0.75, 0.75, 5.65, 0.75, 12);
    ctx.bezierCurveTo(0.75, 20.5, 12, 31.25, 12, 31.25);
    ctx.bezierCurveTo(12, 31.25, 23.25, 20.5, 23.25, 12);
    ctx.bezierCurveTo(23.25, 5.65, 18.35, 0.75, 12, 0.75);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(12, 12, 4.25, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();
  }

  // Collapsed cluster: a filled point carrying the member count. Clicking it
  // spiderfies (or zooms in when the members sit at different coordinates).
  private drawClusterBadge(ctx: CanvasRenderingContext2D, cluster: ProjectedCluster) {
    const count = cluster.members.length;
    const r = count < 10 ? 15 : count < 100 ? 18 : 21;
    const selected = cluster.members.some((m) => m.selected);

    this.clusterHitTargets.push({ x: cluster.x, y: cluster.y, r: r + 4, members: cluster.members });

    ctx.save();
    ctx.beginPath();
    ctx.arc(cluster.x, cluster.y, r + 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(37,99,235,0.25)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cluster.x, cluster.y, r, 0, Math.PI * 2);
    ctx.fillStyle = selected ? "#1d4ed8" : "#2563eb";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${count < 100 ? 13 : 11}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(count > 999 ? "999+" : String(count), cluster.x, cluster.y);
    ctx.restore();
  }

  // Expanded cluster: fan the members out around the cluster point in one or
  // more rings, each connected back to a central hub by a leg.
  private drawSpider(ctx: CanvasRenderingContext2D, cluster: ProjectedCluster) {
    const offsets = spiderOffsets(cluster.members.length);

    ctx.save();
    ctx.strokeStyle = "rgba(37,99,235,0.55)";
    ctx.lineWidth = 1.5;
    for (const off of offsets) {
      ctx.beginPath();
      ctx.moveTo(cluster.x, cluster.y);
      ctx.lineTo(cluster.x + off.dx, cluster.y + off.dy);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cluster.x, cluster.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#1d4ed8";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.restore();

    cluster.members.forEach((pin, i) => {
      const off = offsets[i];
      this.drawPinAt(ctx, cluster.x + off.dx, cluster.y + off.dy, pin, pin.selected ? "#2563eb" : "#3b82f6", pin.selected ? 34 : 30);
    });
  }

  private findHit(event: MouseEvent) {
    if (!this.map) return null;
    const point = this.map.mouseEventToLayerPoint(event).subtract(this.topLeft);
    for (let i = this.techHitTargets.length - 1; i >= 0; i -= 1) {
      const pin = this.techHitTargets[i];
      if (this.pinContainsPoint(pin, point)) return pin;
    }
    for (let i = this.leadHitTargets.length - 1; i >= 0; i -= 1) {
      const pin = this.leadHitTargets[i];
      if (this.pinContainsPoint(pin, point)) return pin;
    }
    return null;
  }

  private pinContainsPoint(pin: CanvasHitTarget, point: L.Point) {
    return point.x >= pin.minX
      && point.x <= pin.maxX
      && point.y >= pin.minY
      && point.y <= pin.maxY;
  }

  private findClusterHit(event: MouseEvent): ClusterHitTarget | null {
    if (!this.map) return null;
    const point = this.map.mouseEventToLayerPoint(event).subtract(this.topLeft);
    for (let i = this.clusterHitTargets.length - 1; i >= 0; i -= 1) {
      const c = this.clusterHitTargets[i];
      const dx = c.x - point.x;
      const dy = c.y - point.y;
      if (dx * dx + dy * dy <= c.r * c.r) return c;
    }
    return null;
  }

  private activateCluster(cluster: ClusterHitTarget) {
    if (!this.map) return;
    // When the members sit at genuinely different coordinates, zooming in
    // separates them (nicer than a fan). A city sharing one ZIP centroid can
    // never separate, so it always fans out instead.
    const distinct = new Set(cluster.members.map((m) => `${m.lat.toFixed(3)},${m.lng.toFixed(3)}`));
    if (distinct.size > 1 && (this.map.getZoom() ?? 0) < 15) {
      const bounds = L.latLngBounds(cluster.members.map((m) => [m.lat, m.lng] as L.LatLngTuple));
      this.map.flyToBounds(bounds.pad(0.3), { maxZoom: 15, duration: 0.4 });
      return;
    }
    this.spiderIds = new Set(cluster.members.map((m) => m.id));
    this.scheduleRedraw();
  }

  private handleClick = (event: MouseEvent) => {
    if (!this.map) return;

    // Individual pins (including fanned-out spider pins) take priority.
    const hit = this.findHit(event);
    if (hit) {
      L.DomEvent.stop(event);
      const latlng = L.latLng(hit.lat, hit.lng);
      if (hit.kind === "tech") this.onTechClick(hit.id, latlng);
      else this.onLeadClick(hit.id, latlng);
      return;
    }

    // A collapsed cluster badge → expand it (or zoom to separate).
    const cluster = this.findClusterHit(event);
    if (cluster) {
      L.DomEvent.stop(event);
      this.activateCluster(cluster);
      return;
    }

    // Empty click collapses any open fan.
    if (this.spiderIds) {
      this.spiderIds = null;
      this.scheduleRedraw();
    }
  };

  private handleMouseMove = (event: MouseEvent) => {
    if (!this.canvas || this.isMoving) return;
    this.lastMouseMoveEvent = event;
    if (this.hoverFrame !== null) return;
    this.hoverFrame = window.requestAnimationFrame(() => {
      this.hoverFrame = null;
      if (!this.canvas || this.isMoving || !this.lastMouseMoveEvent) return;
      const hit = this.findHit(this.lastMouseMoveEvent);
      if (hit) {
        this.canvas.style.cursor = "pointer";
        this.canvas.title = hit.kind === "tech" ? this.getTechTooltip(hit.id) : "";
        return;
      }
      const cluster = this.findClusterHit(this.lastMouseMoveEvent);
      this.canvas.style.cursor = cluster ? "pointer" : "";
      this.canvas.title = cluster ? `${cluster.members.length} technicians — click to expand` : "";
    });
  };

  private handleMouseLeave = () => {
    this.lastMouseMoveEvent = null;
    if (this.hoverFrame !== null) {
      window.cancelAnimationFrame(this.hoverFrame);
      this.hoverFrame = null;
    }
    if (!this.canvas) return;
    this.canvas.style.cursor = "";
    this.canvas.title = "";
  };
}

// Pinpoint marker for a specific-address search. A divIcon avoids Leaflet's
// default-marker image, which does not resolve under the bundler.
const searchPinIcon = L.divIcon({
  className: "marshmallow-search-marker",
  html:
    `<svg width="26" height="34" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="M12 0.75C5.65 0.75 0.75 5.65 0.75 12C0.75 20.5 12 31.25 12 31.25C12 31.25 23.25 20.5 23.25 12C23.25 5.65 18.35 0.75 12 0.75Z" fill="#7c3aed" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<circle cx="12" cy="12" r="4.25" fill="#ffffff"/></svg>`,
  iconSize: [26, 34],
  iconAnchor: [13, 32],
  popupAnchor: [0, -30],
});

function escapeHtml(v: string) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function phoneTelHref(phone: string) {
  return phone ? `tel:${phone.startsWith("+") ? "+" : ""}${phone.replace(/\D/g, "")}` : "";
}

function leadMarkerLatLng(l: MappedLead): L.LatLngTuple {
  let latHash = 0;
  let lngHash = 0;
  for (let i = 0; i < l.id.length; i++) {
    latHash = (latHash * 31 + l.id.charCodeAt(i) + 1) | 0;
    lngHash = (lngHash * 31 + l.id.charCodeAt(i) + 7) | 0;
  }
  const latJitter = (((latHash % 1000) / 500) - 1) * 0.0015;
  const lngJitter = (((lngHash % 1000) / 500) - 1) * 0.0015;
  return [l.coords.latitude + latJitter, l.coords.longitude + lngJitter];
}

export default function MapViewPage() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const isMobile = useIsMobile();

  const mapRef = useRef<L.Map | null>(null);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const pinLayerRef = useRef<MapPinCanvasLayer | null>(null);
  const radiusLayer = useRef<L.Circle | null>(null);
  // The searched area's outline (city / ZIP / county) and the pinpoint marker.
  const boundaryLayerRef = useRef<L.Layer | null>(null);
  const searchMarkerRef = useRef<L.Marker | null>(null);
  // Coverage tool: green "good coverage" circles the user draws by clicking.
  // One entry per area id, each with its circle + center dot Leaflet layers.
  const coverageLayersRef = useRef<Map<string, { circle: L.Circle; dot: L.CircleMarker }>>(new Map());
  const leadDataRefs = useRef<Map<string, MappedLead>>(new Map());
  const techDataRefs = useRef<Map<string, SearchableTech>>(new Map());
  const selectedTechRef = useRef<SearchableTech | null>(null);
  const activeSelectedTechIdRef = useRef<string | null>(null);
  const isMobileRef = useRef(isMobile);
  const mapPopupRef = useRef<L.Popup | null>(null);
  const visibleLeadIdsRef = useRef<Set<string>>(new Set());
  const desiredVisibleLeadIdsRef = useRef<Set<string>>(new Set());
  const leadVisibilityFrameRef = useRef<number | null>(null);
  const leadVisibilityGenerationRef = useRef(0);
  const mapInvalidateTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadFocusTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const techFocusTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedTechId, setSelectedTechId] = useState<string | null>(null);
  const [multiTechSelectMode, setMultiTechSelectMode] = useState(false);
  const [selectedTechIds, setSelectedTechIds] = useState<string[]>([]);
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  // One unified search box handles technicians, customers, and locations.
  const [omniSearch, setOmniSearch] = useState("");
  const [showOmni, setShowOmni] = useState(false);
  const [omniActiveIndex, setOmniActiveIndex] = useState(0);
  const [geocoding, setGeocoding] = useState(false);
  const [pendingFocusTechId, setPendingFocusTechId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [zipDatasetReady, setZipDatasetReady] = useState(false);
  const [mapVisible, setMapVisible] = useState(false);
  const [viewMode, setViewMode] = useState<"leads" | "techs" | "both">("both");
  const [pendingFocusLeadId, setPendingFocusLeadId] = useState<string | null>(null);
  // Kept for the tech/lead list filters, which now stay unfiltered by area
  // (location search draws a boundary instead of filtering the pins).
  const [areaQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [mapReady, setMapReady] = useState(false);
  const [pinRenderVersion, setPinRenderVersion] = useState(0);
  // When on, the map shows the deactivated technicians instead of the active
  // ones, so they can be re-activated from the map's detail panel.
  const [showInactiveTechs, setShowInactiveTechs] = useState(false);
  // Coverage tool state: when on, each empty click on the map adds a new green
  // "good coverage" circle. Each area has its own radius and a name (defaulting
  // to the clicked location's city, editable). `coverageRadiusInput` is the
  // radius (miles) used for the NEXT circle added.
  const [coverageOn, setCoverageOn] = useState(false);
  const [coverageRadiusInput, setCoverageRadiusInput] = useState("40");
  const [coverageAreas, setCoverageAreas] = useState<CoverageArea[]>([]);
  const defaultCoverageMiles = useMemo(() => {
    const n = parseFloat(coverageRadiusInput);
    if (!Number.isFinite(n) || n <= 0) return 40;
    return Math.min(n, 3000);
  }, [coverageRadiusInput]);

  const loadCoverageAreas = useCallback(async () => {
    const { data, error } = await supabase
      .from("map_coverage_areas")
      .select("id, name, latitude, longitude, radius_miles, is_active")
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Failed to load synchronized coverage areas", error);
      return;
    }
    setCoverageAreas(((data ?? []) as CoverageAreaRow[]).map(coverageAreaFromRow));
  }, []);

  useEffect(() => {
    void loadCoverageAreas();
    const channel = supabase
      .channel("map-coverage-areas-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "map_coverage_areas" },
        () => void loadCoverageAreas(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadCoverageAreas]);

  const updateCoverageAreaLocal = useCallback((id: string, patch: Partial<Omit<CoverageArea, "id" | "center">>) => {
    setCoverageAreas((prev) => prev.map((area) => (area.id === id ? { ...area, ...patch } : area)));
  }, []);

  const saveCoverageArea = useCallback(async (
    id: string,
    patch: Partial<Pick<CoverageArea, "name" | "radiusMiles" | "isActive">>,
  ) => {
    updateCoverageAreaLocal(id, patch);
    const databasePatch: { name?: string; radius_miles?: number; is_active?: boolean } = {};
    if (patch.name !== undefined) databasePatch.name = patch.name;
    if (patch.radiusMiles !== undefined) databasePatch.radius_miles = patch.radiusMiles;
    if (patch.isActive !== undefined) databasePatch.is_active = patch.isActive;
    const { error } = await supabase.from("map_coverage_areas").update(databasePatch).eq("id", id);
    if (error) {
      toast.error("Could not save coverage area");
      await loadCoverageAreas();
    }
  }, [loadCoverageAreas, updateCoverageAreaLocal]);

  const createCoverageArea = useCallback(async (center: LatLng) => {
    const { data, error } = await supabase
      .from("map_coverage_areas")
      .insert({
        name: "",
        latitude: center.latitude,
        longitude: center.longitude,
        radius_miles: defaultCoverageMiles,
        is_active: true,
      })
      .select("id, name, latitude, longitude, radius_miles, is_active")
      .single();
    if (error || !data) {
      toast.error("Could not add coverage area");
      return;
    }
    const area = coverageAreaFromRow(data as CoverageAreaRow);
    setCoverageAreas((prev) => [...prev.filter((item) => item.id !== area.id), area]);
    const city = await reverseGeocodeCity(center.latitude, center.longitude);
    if (city) await saveCoverageArea(area.id, { name: city });
  }, [defaultCoverageMiles, saveCoverageArea]);

  const deleteCoverageArea = useCallback(async (id: string) => {
    setCoverageAreas((prev) => prev.filter((area) => area.id !== id));
    const { error } = await supabase.from("map_coverage_areas").delete().eq("id", id);
    if (error) {
      toast.error("Could not remove coverage area");
      await loadCoverageAreas();
    }
  }, [loadCoverageAreas]);

  const clearCoverageAreas = useCallback(async () => {
    const ids = coverageAreas.map((area) => area.id);
    if (ids.length === 0) return;
    setCoverageAreas([]);
    const { error } = await supabase.from("map_coverage_areas").delete().in("id", ids);
    if (error) {
      toast.error("Could not clear coverage areas");
      await loadCoverageAreas();
    }
  }, [coverageAreas, loadCoverageAreas]);

  const urgentLeadsQuery = useQuery({
    queryKey: ["map-urgent-leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, job_id, customer_name, customer_phone, address, city, state, zip_code, service_type, status, latitude, longitude")
        .eq("status", "urgent_job")
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as UrgentLead[];
    },
    staleTime: 60_000,
  });

  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("map-page-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads" },
        (payload) => {
          const newRow = payload.new as UrgentLead | undefined;
          const oldRow = payload.old as UrgentLead | undefined;

          queryClient.setQueryData<UrgentLead[]>(["map-urgent-leads"], (old) => {
            if (!old) return old;

            if (payload.eventType === "INSERT" && newRow) {
              if (newRow.status === "urgent_job") return [...old, newRow];
            } else if (payload.eventType === "UPDATE" && newRow) {
              const exists = old.some(l => l.id === newRow.id);
              if (exists) {
                if (newRow.status === "urgent_job") {
                  return old.map(l => l.id === newRow.id ? { ...l, ...newRow } : l);
                } else {
                  return old.filter(l => l.id !== newRow.id);
                }
              } else if (newRow.status === "urgent_job") {
                return [...old, newRow];
              }
            } else if (payload.eventType === "DELETE" && oldRow) {
              return old.filter(l => l.id !== oldRow.id);
            }
            return old;
          });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const techniciansQuery = useQuery({
    queryKey: TECHNICIANS_QUERY_KEY,
    queryFn: fetchAllTechnicians,
    staleTime: 60_000,
  });

  useEffect(() => {
    let cancelled = false;
    preloadZipDataset().finally(() => { if (!cancelled) setZipDatasetReady(true); });
    return () => { cancelled = true; };
  }, []);

  const mappedLeads = useMemo<MappedLead[]>(() => {
    if (!zipDatasetReady) return [];
    const rows = urgentLeadsQuery.data ?? [];
    const out: MappedLead[] = [];
    for (const l of rows) {
      const zip = resolveZip({ zip_code: l.zip_code, address: l.address });
      const centroid: ZipCentroid | null = lookupZipCentroidSync(zip);
      const hasSavedCoords = isValidLatLng(l.latitude, l.longitude);
      if (!hasSavedCoords && !centroid) continue;
      out.push({
        ...l,
        coords: hasSavedCoords
          ? { latitude: l.latitude as number, longitude: l.longitude as number }
          : { latitude: centroid?.latitude as number, longitude: centroid?.longitude as number },
        zip: zip ?? "",
        zipCity: centroid?.city ?? l.city ?? "",
        zipState: centroid?.state ?? l.state ?? "",
      });
    }
    return out;
  }, [urgentLeadsQuery.data, zipDatasetReady]);

  const nameCounts = useMemo(
    () => buildTechnicianNameCounts(techniciansQuery.data ?? []),
    [techniciansQuery.data],
  );

  const searchableTechs = useMemo<SearchableTech[]>(() => {
    if (!zipDatasetReady) return [];
    // Normally the map shows active technicians. The "Inactive techs" view flips
    // this to show only the toggled-off ones, so they can be re-activated here.
    return (techniciansQuery.data ?? [])
      .filter((t) => (showInactiveTechs ? t.is_active === false : t.is_active !== false))
      .map((t) => {
      if (isValidLatLng(t.latitude, t.longitude)) {
        return {
          ...t,
          coords: { latitude: t.latitude as number, longitude: t.longitude as number },
          locationUnavailable: false,
        };
      }
      // Techs store "area" as free text (often "City, ST" with no ZIP), so fall
      // back from ZIP lookup to a city/state centroid to place the rest.
      const centroid = lookupAreaCentroidSync(t.area);
      if (centroid) {
        return {
          ...t,
          coords: { latitude: centroid.latitude, longitude: centroid.longitude },
          locationUnavailable: false,
        };
      }
      return { ...t, coords: null, locationUnavailable: true };
    });
  }, [techniciansQuery.data, zipDatasetReady, showInactiveTechs]);

  const mappedTechs = useMemo<MappedTech[]>(() => {
    return searchableTechs
      .filter((t): t is SearchableTech & { coords: LatLng; locationUnavailable: false } => !!t.coords && !t.locationUnavailable)
      .map((t) => ({ ...t, coords: t.coords }));
  }, [searchableTechs]);

  const services = useMemo(() => {
    const set = new Set<string>();
    for (const t of techniciansQuery.data ?? []) if (t.is_active !== false && t.service) set.add(t.service);
    return Array.from(set).sort();
  }, [techniciansQuery.data]);

  const extractStateFromText = useCallback((s: string | null | undefined): string | null => {
    if (!s) return null;
    const txt = s.trim();
    if (!txt) return null;
    // Match 2-letter code as whole token
    const m = txt.match(/\b([A-Z]{2})\b/);
    if (m && US_STATES[m[1]]) return m[1];
    const lower = txt.toLowerCase();
    for (const name in STATE_NAME_TO_CODE) {
      if (lower.includes(name)) return STATE_NAME_TO_CODE[name];
    }
    return null;
  }, []);

  const availableStates = useMemo(() => {
    const set = new Set<string>();
    for (const l of mappedLeads) {
      const code = (l.state && l.state.length === 2 ? l.state.toUpperCase() : extractStateFromText(l.state)) || extractStateFromText(l.zipState);
      if (code && US_STATES[code]) set.add(code);
    }
    for (const t of searchableTechs) {
      const code = extractStateFromText(t.area);
      if (code && US_STATES[code]) set.add(code);
    }
    return Array.from(set).sort();
  }, [extractStateFromText, mappedLeads, searchableTechs]);

  const techMatchesArea = useCallback((t: TechnicianRecord, area: string) => {
    if (!area) return true;
    const q = area.trim().toLowerCase();
    return (t.area ?? "").toLowerCase().includes(q) || (t.name ?? "").toLowerCase().includes(q);
  }, []);
  const leadMatchesArea = useCallback((l: Pick<UrgentLead, "address" | "city" | "state" | "zip_code"> & { zipCity?: string; zipState?: string }, area: string) => {
    if (!area) return true;
    const q = area.trim().toLowerCase();
    return [l.address, l.city, l.state, l.zip_code, l.zipCity, l.zipState]
      .some((v) => (v ?? "").toString().toLowerCase().includes(q));
  }, []);
  const techMatchesState = useCallback((t: TechnicianRecord, code: string) => {
    if (code === "all") return true;
    return extractStateFromText(t.area) === code;
  }, [extractStateFromText]);
  const leadMatchesState = useCallback((l: Pick<UrgentLead, "state"> & { zipState?: string }, code: string) => {
    if (code === "all") return true;
    const lc = (l.state && l.state.length === 2 ? l.state.toUpperCase() : extractStateFromText(l.state)) || extractStateFromText(l.zipState);
    return lc === code;
  }, [extractStateFromText]);

  const filteredSearchableTechs = useMemo(() => {
    return searchableTechs.filter((t) => {
      if (serviceFilter !== "all" && (t.service ?? "") !== serviceFilter) return false;
      if (!techMatchesState(t, stateFilter)) return false;
      if (!techMatchesArea(t, areaQuery)) return false;
      return true;
    });
  }, [areaQuery, searchableTechs, serviceFilter, stateFilter, techMatchesArea, techMatchesState]);

  const filteredTechs = useMemo(() => {
    return filteredSearchableTechs
      .filter((t): t is SearchableTech & { coords: LatLng; locationUnavailable: false } => !!t.coords && !t.locationUnavailable)
      .map((t) => ({ ...t, coords: t.coords }))
      .filter((tech) => {
        const anchor = searchableTechs.find((item) => item.id === selectedTechId);
        if (!multiTechSelectMode || !anchor?.coords) return true;
        return haversineMiles(anchor.coords, tech.coords) <= RADIUS_MILES;
      });
  }, [filteredSearchableTechs, multiTechSelectMode, searchableTechs, selectedTechId]);

  const filteredLeads = useMemo(() => {
    return mappedLeads.filter((l) => {
      if (!leadMatchesState(l, stateFilter)) return false;
      if (!leadMatchesArea(l, areaQuery)) return false;
      return true;
    });
  }, [areaQuery, leadMatchesArea, leadMatchesState, mappedLeads, stateFilter]);

  const filteredUrgentLeadTotal = useMemo(() => {
    if (!zipDatasetReady) return 0;
    return (urgentLeadsQuery.data ?? []).filter((l) => {
      const zip = resolveZip({ zip_code: l.zip_code, address: l.address });
      const centroid = lookupZipCentroidSync(zip);
      const leadForFilters = {
        ...l,
        zipCity: centroid?.city ?? "",
        zipState: centroid?.state ?? "",
      };
      if (!leadMatchesState(leadForFilters, stateFilter)) return false;
      if (!leadMatchesArea(leadForFilters, areaQuery)) return false;
      return true;
    }).length;
  }, [areaQuery, leadMatchesArea, leadMatchesState, stateFilter, urgentLeadsQuery.data, zipDatasetReady]);

  const technicianCountLabel = filteredSearchableTechs.length === filteredTechs.length
    ? `${filteredTechs.length} techs`
    : `${filteredSearchableTechs.length} techs · ${filteredTechs.length} mapped`;
  const urgentLeadCountLabel = filteredUrgentLeadTotal === filteredLeads.length
    ? `${filteredLeads.length} urgent leads`
    : `${filteredUrgentLeadTotal} urgent leads · ${filteredLeads.length} mapped`;

  const selectedTech = useMemo(
    () => filteredSearchableTechs.find((t) => t.id === selectedTechId) ?? searchableTechs.find((t) => t.id === selectedTechId) ?? null,
    [filteredSearchableTechs, searchableTechs, selectedTechId],
  );

  useEffect(() => {
    selectedTechRef.current = selectedTech;
  }, [selectedTech]);

  useEffect(() => {
    isMobileRef.current = isMobile;
  }, [isMobile]);

  const leadsInRange = useMemo(() => {
    if (!selectedTech?.coords) return [] as Array<MappedLead & { distance: number }>;
    return filteredLeads
      .map((l) => ({ ...l, distance: haversineMiles(selectedTech.coords, l.coords) }))
      .filter((l) => l.distance <= RADIUS_MILES)
      .sort((a, b) => a.distance - b.distance);
  }, [selectedTech, filteredLeads]);

  const getMapPopup = useCallback(() => {
    if (!mapPopupRef.current) {
      mapPopupRef.current = L.popup({
        autoPan: true,
        autoClose: true,
        closeOnClick: true,
        closeButton: true,
        keepInView: true,
        autoPanPaddingTopLeft: L.point(16, 16),
        autoPanPaddingBottomRight: L.point(16, 16),
        minWidth: 230,
        maxWidth: 360,
      });
    }
    return mapPopupRef.current;
  }, []);

  const openSharedPopup = useCallback((latlng: L.LatLngExpression, content: HTMLElement) => {
    const map = mapRef.current;
    if (!map) return;
    const popup = getMapPopup();
    map.closePopup(popup);
    popup.setLatLng(latlng).setContent(content).openOn(map);
    popup.update();
  }, [getMapPopup]);

  const createTechPopupElement = useCallback((t: SearchableTech) => {
    const root = document.createElement("div");
    root.style.minWidth = "280px";
    root.style.maxWidth = "360px";
    root.style.maxHeight = "420px";
    root.style.overflowY = "auto";
    root.style.fontFamily = "inherit";
    root.addEventListener("click", (event) => event.stopPropagation());

    const phone = (t.phone_number ?? "").trim();
    const telHref = phoneTelHref(phone);
    const phoneBlock = phone
      ? `<div style="margin-top:6px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">Phone</div>
           <a href="${escapeHtml(telHref)}" style="font-size:13px;color:#2563eb;font-weight:600;text-decoration:none">${escapeHtml(phone)}</a>
           <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap">
             <a href="${escapeHtml(telHref)}" style="padding:4px 8px;background:#111827;color:#fff;border-radius:6px;font-size:11px;text-decoration:none">Call Tech</a>
             <button type="button" class="ml-copy-phone" style="padding:4px 8px;background:#f3f4f6;color:#111827;border:1px solid #e5e7eb;border-radius:6px;font-size:11px;cursor:pointer">Copy Phone</button>
           </div>
         </div>`
      : `<div style="margin-top:6px;font-size:12px;color:#6b7280">No phone number</div>`;
    const serviceBlock = t.service
      ? `<div style="margin-top:8px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">Service</div><div style="font-size:13px">${escapeHtml(t.service)}</div></div>`
      : "";
    const areaBlock = t.area
      ? `<div style="margin-top:8px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">Area</div><div style="font-size:13px">${escapeHtml(t.area)}</div></div>`
      : "";
    const locationBlock = t.locationUnavailable
      ? `<div style="margin-top:8px;font-size:11px;color:#92400e;background:#fef3c7;border:1px solid #fde68a;padding:4px 6px;border-radius:4px">Location unavailable</div>`
      : "";
    const notesBlock = t.notes
      ? `<div style="margin-top:8px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280">Notes</div><div style="font-size:12px;white-space:pre-wrap;word-break:break-word">${escapeHtml(t.notes)}</div></div>`
      : "";
    const chatBtn = t.chat_link
      ? `<div style="margin-top:10px"><a href="${escapeHtml(t.chat_link)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:6px 10px;background:#2563eb;color:#fff;border-radius:6px;font-size:12px;text-decoration:none">Quick Chat</a></div>`
      : "";

    root.innerHTML = `<div style="font-weight:600;font-size:14px">${escapeHtml(t.name)}</div>${phoneBlock}${serviceBlock}${areaBlock}${locationBlock}${notesBlock}${chatBtn}`;
    const copyButton = root.querySelector<HTMLButtonElement>(".ml-copy-phone");
    if (copyButton) {
      copyButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(phone);
          else {
            const ta = document.createElement("textarea");
            ta.value = phone; ta.style.position = "fixed"; ta.style.opacity = "0";
            document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
          }
          toast("Phone number copied");
        } catch { toast("Failed to copy"); }
      });
    }
    return root;
  }, []);

  const createLeadPopupElement = useCallback((l: MappedLead, currentSelectedTech: SearchableTech | null) => {
    const root = document.createElement("div");
    root.style.minWidth = "230px";
    root.style.fontFamily = "inherit";
    root.addEventListener("click", (event) => event.stopPropagation());

    const distance = currentSelectedTech?.coords ? haversineMiles(currentSelectedTech.coords, l.coords) : null;
    const zipCity = [l.zipCity, l.zipState].filter(Boolean).join(", ");
    const distanceLine = currentSelectedTech && distance !== null && distance <= RADIUS_MILES
      ? `<div style="font-size:11px;color:#6b7280;margin-top:4px">${distance.toFixed(1)} mi from ${escapeHtml(currentSelectedTech.name)} (approx.)</div>`
      : "";

    root.innerHTML = `
      <div style="font-weight:600;font-size:13px">${escapeHtml(l.customer_name || "Unnamed")}</div>
      <div style="font-size:11px;color:#6b7280">Job ${escapeHtml(l.job_id ?? "")}</div>
      <div style="margin-top:6px;font-size:12px">${escapeHtml(l.customer_phone || "")}</div>
      <div style="font-size:12px"><b>ZIP:</b> ${escapeHtml(l.zip)}${zipCity ? ` <span style="color:#6b7280">· ${escapeHtml(zipCity)}</span>` : ""}</div>
      <div style="margin-top:6px;font-size:12px"><b>Service:</b> ${escapeHtml(l.service_type || "-")}</div>
      <div style="font-size:12px"><b>Status:</b> ${escapeHtml(STATUS_LABELS[l.status] ?? l.status)}</div>
      ${distanceLine}
      <div style="margin-top:6px;font-size:10px;color:#92400e;background:#fef3c7;border:1px solid #fde68a;padding:3px 6px;border-radius:4px;display:inline-block">Approximate ZIP area</div>
      <div><button type="button" class="ml-view-lead" style="margin-top:8px;padding:6px 10px;background:#111827;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer">View Lead</button></div>
    `;
    const viewButton = root.querySelector<HTMLButtonElement>(".ml-view-lead");
    if (viewButton) {
      viewButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        navigate(`/leads/${l.id}`);
      });
    }
    return root;
  }, [navigate]);

  const applyTechMarkerSelection = useCallback((techId: string | null) => {
    activeSelectedTechIdRef.current = techId;
    setPinRenderVersion((version) => version + 1);
  }, []);

  const openTechPopup = useCallback((techId: string, latlng: L.LatLngExpression) => {
    const tech = techDataRefs.current.get(techId);
    if (!tech) return;
    openSharedPopup(latlng, createTechPopupElement(tech));
  }, [createTechPopupElement, openSharedPopup]);

  const openLeadPopup = useCallback((leadId: string, latlng: L.LatLngExpression) => {
    const lead = leadDataRefs.current.get(leadId);
    if (!lead) return;
    openSharedPopup(latlng, createLeadPopupElement(lead, selectedTechRef.current));
  }, [createLeadPopupElement, openSharedPopup]);

  const cancelLeadVisibilityWork = useCallback(() => {
    leadVisibilityGenerationRef.current += 1;
    if (leadVisibilityFrameRef.current !== null) {
      window.cancelAnimationFrame(leadVisibilityFrameRef.current);
      leadVisibilityFrameRef.current = null;
    }
  }, []);

  const scheduleLeadVisibility = useCallback((nextVisibleLeadIds: Set<string>) => {
    desiredVisibleLeadIdsRef.current = new Set(nextVisibleLeadIds);
    if (!pinLayerRef.current) return;
    cancelLeadVisibilityWork();
    const generation = leadVisibilityGenerationRef.current;
    const visibleLeadIds = visibleLeadIdsRef.current;
    const toAdd: string[] = [];
    const toRemove: string[] = [];

    for (const id of nextVisibleLeadIds) {
      if (leadDataRefs.current.has(id) && !visibleLeadIds.has(id)) toAdd.push(id);
    }
    for (const id of visibleLeadIds) {
      if (!nextVisibleLeadIds.has(id) || !leadDataRefs.current.has(id)) toRemove.push(id);
    }

    const applyAllNow = activeSelectedTechIdRef.current === null;
    const batchSize = 40;
    const runBatch = () => {
      if (leadVisibilityGenerationRef.current !== generation) return;
      let processed = 0;
      while ((applyAllNow || processed < batchSize) && (toRemove.length || toAdd.length)) {
        const removeId = toRemove.pop();
        if (removeId) {
          visibleLeadIds.delete(removeId);
          processed += 1;
          continue;
        }

        const addId = toAdd.pop();
        if (addId) {
          if (leadDataRefs.current.has(addId)) visibleLeadIds.add(addId);
          processed += 1;
        }
      }
      setPinRenderVersion((version) => version + 1);
      if (toRemove.length || toAdd.length) {
        leadVisibilityFrameRef.current = window.requestAnimationFrame(runBatch);
      } else {
        leadVisibilityFrameRef.current = null;
      }
    };

    runBatch();
  }, [cancelLeadVisibilityWork]);

  const handleTechMarkerClick = useCallback((techId: string, latlng: L.LatLng) => {
    const tech = techDataRefs.current.get(techId);
    if (!tech) return;
    if (multiTechSelectMode) {
      const anchor = selectedTechRef.current;
      if (!anchor?.coords) {
        selectedTechRef.current = tech;
        setSelectedTechId(techId);
        setSelectedTechIds([techId]);
        return;
      }
      if (haversineMiles(anchor.coords, tech.coords) > RADIUS_MILES) {
        toast(`Choose technicians within ${RADIUS_MILES} miles of the selected anchor.`);
        return;
      }
      setSelectedTechIds((current) => current.includes(techId)
        ? current.filter((id) => id !== techId)
        : current.length >= 8
          ? (toast("Select up to 8 technicians per report."), current)
          : [...current, techId]);
      return;
    }
    cancelLeadVisibilityWork();
    selectedTechRef.current = tech;
    applyTechMarkerSelection(techId);
    openTechPopup(techId, latlng);
    setSelectedTechId(techId);
    if (isMobileRef.current) setSheetOpen(true);
  }, [applyTechMarkerSelection, cancelLeadVisibilityWork, multiTechSelectMode, openTechPopup]);

  const clearSelectedTech = useCallback(() => {
    cancelLeadVisibilityWork();
    selectedTechRef.current = null;
    applyTechMarkerSelection(null);
    setSelectedTechId(null);
    setSelectedTechIds([]);
  }, [applyTechMarkerSelection, cancelLeadVisibilityWork]);

  useEffect(() => {
    if (!mapVisible) return;
    if (mapRef.current || !mapEl.current) return;
    setMapReady(false);
    const map = L.map(mapEl.current, { zoomControl: true, preferCanvas: true, markerZoomAnimation: false }).setView([39.5, -98.35], 4);
    const leadPane = map.createPane("marshmallow-lead-pins");
    const techPane = map.createPane("marshmallow-tech-pins");
    leadPane.style.zIndex = "610";
    techPane.style.zIndex = "620";
    // Coverage circles render ABOVE the pins but never intercept clicks, so the
    // green layer stays on top visually while pins under it stay clickable.
    const coveragePane = map.createPane("marshmallow-coverage");
    coveragePane.style.zIndex = "640";
    coveragePane.style.pointerEvents = "none";
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(map);
    const pinLayer = new MapPinCanvasLayer(
      handleTechMarkerClick,
      (leadId, latlng) => openLeadPopup(leadId, latlng),
      (techId) => techDataRefs.current.get(techId)?.phone_number?.trim() ?? "",
    ).addTo(map);
    pinLayerRef.current = pinLayer;
    mapRef.current = map;
    const leadData = leadDataRefs.current;
    const techData = techDataRefs.current;
    const visibleLeadIds = visibleLeadIdsRef.current;
    const desiredVisibleLeadIds = desiredVisibleLeadIdsRef.current;
    mapInvalidateTimeout.current = setTimeout(() => map.invalidateSize(), 50);
    setMapReady(true);
    return () => {
      setMapReady(false);
      cancelLeadVisibilityWork();
      if (mapInvalidateTimeout.current) clearTimeout(mapInvalidateTimeout.current);
      if (leadFocusTimeout.current) clearTimeout(leadFocusTimeout.current);
      if (techFocusTimeout.current) clearTimeout(techFocusTimeout.current);
      mapInvalidateTimeout.current = null;
      leadFocusTimeout.current = null;
      techFocusTimeout.current = null;
      if (mapPopupRef.current) {
        map.closePopup(mapPopupRef.current);
        mapPopupRef.current.remove();
        mapPopupRef.current = null;
      }
      pinLayer.remove();
      map.remove();
      leadData.clear();
      techData.clear();
      visibleLeadIds.clear();
      desiredVisibleLeadIds.clear();
      activeSelectedTechIdRef.current = null;
      mapRef.current = null;
      pinLayerRef.current = null;
      radiusLayer.current = null;
      boundaryLayerRef.current = null;
      searchMarkerRef.current = null;
      coverageLayersRef.current.clear();
    };
  }, [cancelLeadVisibilityWork, handleTechMarkerClick, mapVisible, openLeadPopup]);

  // Canvas marker data
  useEffect(() => {
    if (!mapReady) return;
    const nextIds = new Set(filteredSearchableTechs.map((t) => t.id));
    for (const id of techDataRefs.current.keys()) {
      if (!nextIds.has(id)) {
        techDataRefs.current.delete(id);
      }
    }
    for (const t of filteredSearchableTechs) {
      techDataRefs.current.set(t.id, t);
    }
    setPinRenderVersion((version) => version + 1);
  }, [filteredSearchableTechs, mapReady]);

  useEffect(() => {
    applyTechMarkerSelection(selectedTechId);
  }, [applyTechMarkerSelection, selectedTechId]);

  useEffect(() => {
    if (!mapReady) return;
    const nextIds = new Set(filteredLeads.map((l) => l.id));

    for (const id of leadDataRefs.current.keys()) {
      if (!nextIds.has(id)) {
        leadDataRefs.current.delete(id);
        visibleLeadIdsRef.current.delete(id);
      }
    }

    for (const l of filteredLeads) {
      leadDataRefs.current.set(l.id, l);
    }
    setPinRenderVersion((version) => version + 1);
  }, [filteredLeads, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const visibleLeadIds = new Set((selectedTech ? leadsInRange : filteredLeads).map((l) => l.id));
    if (viewMode === "techs") visibleLeadIds.clear();
    scheduleLeadVisibility(visibleLeadIds);
  }, [filteredLeads, leadsInRange, mapReady, scheduleLeadVisibility, selectedTech, viewMode]);

  useEffect(() => {
    if (!mapReady || !pinLayerRef.current) return;
    const pins: CanvasPin[] = [];
    if (viewMode !== "techs") {
      for (const l of filteredLeads) {
        if (!visibleLeadIdsRef.current.has(l.id)) continue;
        const [lat, lng] = leadMarkerLatLng(l);
        pins.push({ id: l.id, kind: "lead", lat, lng });
      }
    }
    if (viewMode !== "leads") {
      for (const t of filteredTechs) {
        pins.push({
          id: t.id,
          kind: "tech",
          lat: t.coords.latitude,
          lng: t.coords.longitude,
          selected: multiTechSelectMode ? selectedTechIds.includes(t.id) : t.id === activeSelectedTechIdRef.current,
        });
      }
    }
    pinLayerRef.current.setPins(pins);
  }, [filteredLeads, filteredTechs, mapReady, multiTechSelectMode, pinRenderVersion, selectedTechIds, viewMode]);

  // Handle pending customer focus after markers render
  useEffect(() => {
    if (!pendingFocusLeadId) return;
    const map = mapRef.current;
    const lead = leadDataRefs.current.get(pendingFocusLeadId);
    if (!map || !lead) return;
    const latlng = L.latLng(leadMarkerLatLng(lead));
    map.flyTo(latlng, 12, { duration: 0.7 });
    if (leadFocusTimeout.current) clearTimeout(leadFocusTimeout.current);
    leadFocusTimeout.current = setTimeout(() => {
      openLeadPopup(pendingFocusLeadId, latlng);
      leadFocusTimeout.current = null;
    }, 650);
    setPendingFocusLeadId(null);
  }, [mappedLeads, leadsInRange, mapReady, openLeadPopup, pendingFocusLeadId, viewMode]);

  // Selected-tech radius circle
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (selectedTech?.coords) {
      const latlng: L.LatLngExpression = [selectedTech.coords.latitude, selectedTech.coords.longitude];
      if (radiusLayer.current) {
        radiusLayer.current.setLatLng(latlng);
      } else {
        radiusLayer.current = L.circle(latlng, {
          radius: RADIUS_METERS,
          color: "#2563eb",
          weight: 1.5,
          fillColor: "#3b82f6",
          fillOpacity: 0.08,
        }).addTo(map);
      }
    } else if (radiusLayer.current) {
      map.removeLayer(radiusLayer.current);
      radiusLayer.current = null;
    }
  }, [selectedTech, mapVisible]);

  // Coverage tool: while active, each empty click on the map adds a new coverage
  // circle at the clicked point, using the current radius. (Marker clicks are
  // consumed by the pin layer, so they don't fire here.) The new area's name
  // defaults to the clicked location's city, resolved in the background.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !coverageOn) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      const center: LatLng = { latitude: e.latlng.lat, longitude: e.latlng.lng };
      void createCoverageArea(center);
    };
    map.on("click", onClick);
    const container = map.getContainer();
    const prevCursor = container.style.cursor;
    container.style.cursor = "crosshair";
    return () => {
      map.off("click", onClick);
      container.style.cursor = prevCursor;
    };
  }, [coverageOn, createCoverageArea, mapReady]);

  // Draw / reconcile all coverage circles (+ center dots + name labels).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layers = coverageLayersRef.current;
    const wanted = coverageAreas.filter((a) => a.isActive && a.radiusMiles > 0);
    const wantedIds = new Set(wanted.map((a) => a.id));

    // Remove circles that are gone or hidden.
    for (const [id, layer] of layers) {
      if (!wantedIds.has(id)) {
        map.removeLayer(layer.circle);
        map.removeLayer(layer.dot);
        layers.delete(id);
      }
    }

    // Add or update the rest.
    for (const area of wanted) {
      const latlng: L.LatLngExpression = [area.center.latitude, area.center.longitude];
      const radiusMeters = area.radiusMiles * 1609.344;
      const label = area.name?.trim() || `${area.radiusMiles} mi coverage`;
      const existing = layers.get(area.id);
      if (existing) {
        existing.circle.setLatLng(latlng).setRadius(radiusMeters);
        existing.circle.setTooltipContent(label);
        existing.dot.setLatLng(latlng);
      } else {
        const circle = L.circle(latlng, {
          pane: "marshmallow-coverage",
          radius: radiusMeters,
          color: "#16a34a",
          weight: 1.5,
          fillColor: "#22c55e",
          fillOpacity: 0.18,
        }).addTo(map);
        circle.bindTooltip(label, { permanent: true, direction: "center", className: "coverage-label", opacity: 0.95 });
        const dot = L.circleMarker(latlng, {
          pane: "marshmallow-coverage",
          radius: 5,
          color: "#166534",
          weight: 2,
          fillColor: "#22c55e",
          fillOpacity: 1,
        }).addTo(map);
        layers.set(area.id, { circle, dot });
      }
    }
  }, [coverageAreas, mapVisible, mapReady]);

  useEffect(() => {
    if (!mapVisible) return;
    const map = mapRef.current;
    if (!map) return;
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(t);
  }, [mapVisible]);

  const focusLead = (lead: MappedLead) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo([lead.coords.latitude, lead.coords.longitude], 11, { duration: 0.6 });
  };

  const customerMatches = useMemo(() => {
    const q = omniSearch.trim().toLowerCase();
    if (!q) return [] as MappedLead[];
    return mappedLeads
      .filter((l) => (l.customer_name ?? "").toLowerCase().includes(q))
      .slice(0, 6);
  }, [omniSearch, mappedLeads]);

  const techMatches = useMemo(() => {
    const q = omniSearch.trim().toLowerCase();
    if (!q) return [] as SearchableTech[];
    return searchableTechs.filter((t) => {
      if (serviceFilter !== "all" && (t.service ?? "") !== serviceFilter) return false;
      return (t.name ?? "").toLowerCase().includes(q);
    }).slice(0, 6);
  }, [omniSearch, searchableTechs, serviceFilter]);

  // Combined suggestion list: technicians, then customers, then a location
  // action that geocodes the query into a boundary or a pinpoint marker.
  const omniItems = useMemo<OmniItem[]>(() => {
    const items: OmniItem[] = [];
    for (const t of techMatches) items.push({ kind: "tech", tech: t });
    for (const l of customerMatches) items.push({ kind: "customer", lead: l });
    if (omniSearch.trim()) items.push({ kind: "location" });
    return items;
  }, [techMatches, customerMatches, omniSearch]);

  useEffect(() => { setOmniActiveIndex(0); }, [omniSearch]);

  const selectCustomer = (lead: MappedLead) => {
    if (!mapVisible) setMapVisible(true);
    if (viewMode === "techs") setViewMode("both");
    if (selectedTech) {
      const inRange = leadsInRange.some((l) => l.id === lead.id);
      if (!inRange) clearSelectedTech();
    }
    setShowOmni(false);
    setOmniSearch(lead.customer_name || "");
    setPendingFocusLeadId(lead.id);
  };

  const selectTech = (tech: SearchableTech) => {
    if (!mapVisible) setMapVisible(true);
    if (viewMode === "leads") setViewMode("both");
    setShowOmni(false);
    setOmniSearch(tech.name || "");
    setSelectedTechId(tech.id);
    selectedTechRef.current = tech;
    if (tech.coords) {
      setPendingFocusTechId(tech.id);
    } else {
      setPendingFocusTechId(null);
      toast("Location unavailable");
    }
    if (isMobile) setSheetOpen(true);
  };

  const clearSearchOverlays = useCallback(() => {
    const map = mapRef.current;
    if (boundaryLayerRef.current) {
      map?.removeLayer(boundaryLayerRef.current);
      boundaryLayerRef.current = null;
    }
    if (searchMarkerRef.current) {
      map?.removeLayer(searchMarkerRef.current);
      searchMarkerRef.current = null;
    }
  }, []);

  // Geocode the typed query: a city / ZIP / area draws a boundary outline; a
  // specific address drops a pinpoint marker. Then frame the map on the result.
  const runLocationSearch = useCallback(async (rawQuery: string) => {
    const q = rawQuery.trim();
    if (!q) return;
    if (!mapVisible) setMapVisible(true);
    setShowOmni(false);
    setGeocoding(true);
    try {
      const result = await geocodeArea(q);
      const m = mapRef.current;
      if (!m) return;
      if (!result) {
        toast("No matching location found");
        return;
      }
      clearSearchOverlays();

      if (result.isArea) {
        let bounds: L.LatLngBounds | null = null;
        if (result.geojson) {
          const layer = L.geoJSON(result.geojson as unknown as GeoJSON.GeoJsonObject, {
            style: { color: "#2563eb", weight: 2, fillColor: "#3b82f6", fillOpacity: 0.08 },
            interactive: false,
          });
          layer.addTo(m);
          boundaryLayerRef.current = layer;
          bounds = layer.getBounds();
        } else if (result.boundingBox) {
          const [south, north, west, east] = result.boundingBox;
          const rect = L.rectangle([[south, west], [north, east]], {
            color: "#2563eb", weight: 2, fillColor: "#3b82f6", fillOpacity: 0.08, interactive: false,
          });
          rect.addTo(m);
          boundaryLayerRef.current = rect;
          bounds = rect.getBounds();
        }
        if (bounds && bounds.isValid()) {
          m.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
        } else {
          m.flyTo([result.latitude, result.longitude], 11, { duration: 0.6 });
        }
        toast(`Showing area: ${result.displayName.split(",").slice(0, 2).join(",").trim()}`);
      } else {
        const marker = L.marker([result.latitude, result.longitude], { icon: searchPinIcon, keyboard: false });
        marker.addTo(m);
        marker.bindPopup(`<div style="font-weight:600;font-size:12px;max-width:220px">${escapeHtml(result.displayName)}</div>`);
        searchMarkerRef.current = marker;
        m.flyTo([result.latitude, result.longitude], 14, { duration: 0.6 });
        marker.openPopup();
      }
    } catch {
      toast("Location search failed. Please try again.");
    } finally {
      setGeocoding(false);
    }
  }, [clearSearchOverlays, mapVisible]);

  // Enter / activation: run the highlighted suggestion, else search the location.
  const runOmniActivate = () => {
    const item = omniItems[omniActiveIndex] ?? omniItems[0];
    if (!item || item.kind === "location") { void runLocationSearch(omniSearch); return; }
    if (item.kind === "tech") selectTech(item.tech);
    else selectCustomer(item.lead);
  };

  const resetSearch = () => {
    setOmniSearch("");
    setShowOmni(false);
    setPendingFocusLeadId(null);
    setPendingFocusTechId(null);
    clearSearchOverlays();
    clearSelectedTech();
    setStateFilter("all");
    const map = mapRef.current;
    if (map) map.flyTo([39.5, -98.35], 4, { duration: 0.6 });
  };

  useEffect(() => {
    if (!pendingFocusTechId) return;
    const map = mapRef.current;
    const tech = techDataRefs.current.get(pendingFocusTechId) ?? filteredTechs.find((t) => t.id === pendingFocusTechId);
    if (!map || !tech?.coords) return;
    const ll = L.latLng(tech.coords.latitude, tech.coords.longitude);
    map.flyTo(ll, 10, { duration: 0.6 });
    if (techFocusTimeout.current) clearTimeout(techFocusTimeout.current);
    techFocusTimeout.current = setTimeout(() => {
      openTechPopup(pendingFocusTechId, ll);
      techFocusTimeout.current = null;
    }, 650);
    setPendingFocusTechId(null);
  }, [filteredTechs, mapReady, openTechPopup, pendingFocusTechId, viewMode]);


  // Portal-positioned dropdown anchoring for the unified search input.
  const omniInputWrapRef = useRef<HTMLDivElement | null>(null);
  const [omniAnchorRect, setOmniAnchorRect] = useState<{ top: number; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!showOmni) return;
    const update = () => {
      const el = omniInputWrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setOmniAnchorRect({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [showOmni, omniSearch]);


  const highlightMatch = (name: string, query: string) => {
    const q = query.trim();
    if (!q) return name;
    const lower = name.toLowerCase();
    const idx = lower.indexOf(q.toLowerCase());
    if (idx < 0) return name;
    return (
      <>
        {name.slice(0, idx)}
        <span className="bg-primary/25 text-primary-foreground rounded px-0.5">{name.slice(idx, idx + q.length)}</span>
        {name.slice(idx + q.length)}
      </>
    );
  };

  const renderOmniDropdown = () => {
    if (!showOmni || !omniSearch.trim() || !omniAnchorRect) return null;
    const width = Math.max(360, omniAnchorRect.width);
    return createPortal(
      <div
        role="listbox"
        style={{ position: "fixed", top: omniAnchorRect.top, left: omniAnchorRect.left, width, zIndex: 2000 }}
        className="rounded-md border bg-popover text-popover-foreground shadow-xl overflow-hidden"
        onMouseDown={(e) => e.preventDefault()}
      >
        <ul className="max-h-80 overflow-y-auto py-1">
          {omniItems.map((item, i) => {
            const isActive = i === omniActiveIndex;
            const activeCls = isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/60";
            if (item.kind === "tech") {
              const t = item.tech;
              const svcArea = [t.service, t.area].filter(Boolean).join(" \u00b7 ");
              return (
                <li key={`t-${t.id}`} role="option" aria-selected={isActive}>
                  <button
                    type="button"
                    onMouseEnter={() => setOmniActiveIndex(i)}
                    onClick={() => selectTech(t)}
                    className={`w-full text-left px-3 py-2 text-xs flex items-start gap-2 transition-colors ${activeCls}`}
                  >
                    <Wrench className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-500" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="block font-semibold text-sm text-foreground truncate">
                          {highlightMatch(t.name || "Unnamed", omniSearch)}
                        </span>
                        <TechnicianNameBadges tech={t} nameCounts={nameCounts} />
                      </span>
                      <span className="block text-[11px] text-muted-foreground truncate">
                        {t.phone_number || "No phone number"}{svcArea ? ` \u00b7 ${svcArea}` : ""}
                      </span>
                      {t.locationUnavailable && (
                        <span className="block text-[11px] text-amber-600">Location unavailable</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            }
            if (item.kind === "customer") {
              const l = item.lead;
              const loc = [l.city, l.state].filter(Boolean).join(", ");
              const zip = l.zip_code || l.zip;
              const locLine = [loc, zip].filter(Boolean).join(" ");
              return (
                <li key={`c-${l.id}`} role="option" aria-selected={isActive}>
                  <button
                    type="button"
                    onMouseEnter={() => setOmniActiveIndex(i)}
                    onClick={() => selectCustomer(l)}
                    className={`w-full text-left px-3 py-2 text-xs flex items-start gap-2 transition-colors ${activeCls}`}
                  >
                    <User className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-500" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-sm text-foreground truncate">
                        {highlightMatch(l.customer_name || "Unnamed", omniSearch)}
                      </span>
                      <span className="block text-[11px] text-muted-foreground truncate">
                        Job {l.job_id}{locLine ? ` \u00b7 ${locLine}` : ""}
                      </span>
                      {l.service_type && (
                        <span className="block text-[11px] text-muted-foreground/90 truncate">{l.service_type}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            }
            return (
              <li key="omni-location" role="option" aria-selected={isActive} className="border-t border-border mt-1 pt-1">
                <button
                  type="button"
                  onMouseEnter={() => setOmniActiveIndex(i)}
                  onClick={() => void runLocationSearch(omniSearch)}
                  className={`w-full text-left px-3 py-2.5 text-xs flex items-center gap-2 transition-colors ${activeCls}`}
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                  <span className="min-w-0 truncate">
                    Search location <span className="font-semibold text-foreground">&ldquo;{omniSearch.trim()}&rdquo;</span>
                    <span className="text-muted-foreground"> &mdash; area boundary or pinpoint</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>,
      document.body,
    );
  };




  const [togglingTechActive, setTogglingTechActive] = useState(false);

  // Toggle a technician on/off from the map panel — same active flag as the
  // Technicians tab. Turning it off optimistically updates the shared cache, so
  // the tech drops out of `searchableTechs` (which hides is_active === false)
  // and disappears from the map; the Technicians tab reflects it on next visit.
  const handleToggleTechActive = async (tech: SearchableTech, next: boolean) => {
    if (togglingTechActive) return;
    setTogglingTechActive(true);
    const prev = queryClient.getQueryData<TechnicianRecord[]>(TECHNICIANS_QUERY_KEY);
    queryClient.setQueryData<TechnicianRecord[]>(TECHNICIANS_QUERY_KEY, (old) =>
      old ? old.map((t) => (t.id === tech.id ? { ...t, is_active: next } : t)) : old,
    );
    const { error } = await supabase.from("technicians").update({ is_active: next }).eq("id", tech.id);
    setTogglingTechActive(false);
    if (error) {
      queryClient.setQueryData<TechnicianRecord[]>(TECHNICIANS_QUERY_KEY, prev);
      toast.error("Could not update technician");
      return;
    }
    toast.success(next ? "Technician is now visible on the map" : "Technician hidden from the map");
    // Mark the Technicians-tab queries stale (refetch on next visit) without
    // forcing an immediate heavy refetch of the full map technician list.
    void queryClient.invalidateQueries({ queryKey: ["technicians"], refetchType: "none" });
  };
  const handleToggleGoodTech = async (tech: SearchableTech, next: boolean) => {
    const prev = queryClient.getQueryData<TechnicianRecord[]>(TECHNICIANS_QUERY_KEY);
    queryClient.setQueryData<TechnicianRecord[]>(TECHNICIANS_QUERY_KEY, (old) =>
      old ? old.map((t) => (t.id === tech.id ? { ...t, is_good_tech: next } : t)) : old,
    );
    const { error } = await supabase.from("technicians").update({ is_good_tech: next } as never).eq("id", tech.id);
    if (error) {
      queryClient.setQueryData<TechnicianRecord[]>(TECHNICIANS_QUERY_KEY, prev);
      toast.error("Could not update status");
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["technicians"], refetchType: "none" });
  };

  const SidePanel = (
    <div className="space-y-3">
      {(coverageOn || coverageAreas.length > 0) && (
        <div className="rounded-lg border bg-muted/20 p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-green-600 bg-green-500/25" />
              Synced coverage areas ({coverageAreas.length})
            </div>
            {coverageAreas.length > 0 && (
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => void clearCoverageAreas()}>Clear</Button>
            )}
          </div>
          {coverageAreas.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">Click the map to add a coverage circle. Each is named after its city by default — rename it below.</div>
          ) : (
            <ul className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
              {coverageAreas.map((a, i) => (
                <li key={a.id} className="space-y-1.5 rounded-md border bg-background p-2">
                  <div className="flex items-center gap-1.5">
                    <Switch
                      checked={a.isActive}
                      onCheckedChange={(active) => void saveCoverageArea(a.id, { isActive: active })}
                      aria-label={`${a.isActive ? "Hide" : "Show"} ${a.name || `coverage ${i + 1}`}`}
                    />
                    <Input
                      value={a.name}
                      placeholder={`Coverage ${i + 1}`}
                      onChange={(e) => updateCoverageAreaLocal(a.id, { name: e.target.value })}
                      onBlur={(e) => void saveCoverageArea(a.id, { name: e.target.value.trim() })}
                      className="h-7 flex-1 text-xs"
                      aria-label="Coverage area name"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => void deleteCoverageArea(a.id)}
                      title="Remove this coverage circle"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={a.radiusMiles ? String(a.radiusMiles) : ""}
                      onChange={(e) => {
                        const n = parseFloat(e.target.value);
                        updateCoverageAreaLocal(a.id, { radiusMiles: Number.isFinite(n) && n > 0 ? Math.min(n, 3000) : 0 });
                      }}
                      onBlur={(e) => {
                        const n = parseFloat(e.target.value);
                        if (Number.isFinite(n) && n > 0) void saveCoverageArea(a.id, { radiusMiles: Math.min(n, 3000) });
                        else void loadCoverageAreas();
                      }}
                      className="h-7 w-[68px] text-xs"
                      aria-label="Coverage radius in miles"
                    />
                    <span className="text-[11px] text-muted-foreground">miles radius</span>
                    <button
                      type="button"
                      className="ml-auto text-[11px] text-primary hover:underline"
                      onClick={() => {
                        const m = mapRef.current;
                        if (m) m.setView([a.center.latitude, a.center.longitude], Math.max(m.getZoom(), 8));
                      }}
                    >
                      Focus
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {selectedTech ? (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <TechnicianDetailsContent
                technician={selectedTech}
                onToggleGoodTech={(next) => void handleToggleGoodTech(selectedTech, next)}
              />
              {selectedTech.locationUnavailable && (
                <Badge variant="outline" className="mt-2 text-[11px] text-amber-700 border-amber-300 bg-amber-50">
                  Location unavailable
                </Badge>
              )}
            </div>
            <Button size="icon" variant="ghost" onClick={clearSelectedTech} aria-label="Clear selected technician"><X className="h-4 w-4" /></Button>
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground">Active on map</div>
              <div className="text-[11px] text-muted-foreground">
                {selectedTech.is_active === false ? "Hidden from the map" : "Visible on the map"}
              </div>
            </div>
            <Switch
              checked={selectedTech.is_active !== false}
              disabled={togglingTechActive}
              onCheckedChange={(v) => void handleToggleTechActive(selectedTech, v === true)}
              aria-label={selectedTech.is_active === false ? `Activate ${selectedTech.name}` : `Deactivate ${selectedTech.name}`}
            />
          </div>
          <div className="border-t pt-3">
            <div className="flex flex-wrap gap-2 mb-2">
              <Badge variant="secondary">Coverage: {RADIUS_MILES} mi</Badge>
              <Badge>{leadsInRange.length} urgent lead{leadsInRange.length === 1 ? "" : "s"} in range</Badge>
            </div>
            <div className="text-xs font-medium text-muted-foreground mb-1">Urgent leads by distance</div>
            {leadsInRange.length === 0 ? (
              <div className="text-xs text-muted-foreground">No urgent leads within {RADIUS_MILES} miles.</div>
            ) : (
              <ul className="space-y-1 max-h-[45vh] overflow-y-auto pr-1">
                {leadsInRange.map((l) => {
                  const svcMatch = selectedTech.service && l.service_type &&
                    l.service_type.toLowerCase().includes(selectedTech.service.toLowerCase());
                  return (
                    <li key={l.id} className="rounded-md border p-2 text-xs hover:bg-muted/40 transition cursor-pointer" onClick={() => focusLead(l)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">{l.customer_name || "Unnamed"}</span>
                        <span className="text-muted-foreground shrink-0">{l.distance.toFixed(1)} mi</span>
                      </div>
                      <div className="text-muted-foreground truncate">{l.service_type || "—"}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {svcMatch ? <Badge variant="secondary" className="text-[10px]">Service Match</Badge> : selectedTech.service && <Badge variant="outline" className="text-[10px]">Different Service</Badge>}
                        <Button size="sm" variant="link" className="h-5 px-0 text-[11px]" onClick={(e) => { e.stopPropagation(); navigate(`/leads/${l.id}`); }}>View Lead →</Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground">
          {filteredTechs.length === 0
            ? "Add technicians in the Technicians section to see coverage."
            : `Select a technician marker to see coverage and matching urgent leads within ${RADIUS_MILES} miles.`}
        </div>
      )}
    </div>
  );


  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center">
            <MapPin className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Map View</h1>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              <Contact className="h-3 w-3" /> {technicianCountLabel} · {urgentLeadCountLabel}
              {selectedTech?.coords && <><span>·</span><span>{leadsInRange.length} within {RADIUS_MILES} mi</span></>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5">
          <Label htmlFor="map-visible-toggle" className="text-[11px] font-medium text-foreground cursor-pointer">Map View</Label>
          <Switch id="map-visible-toggle" checked={mapVisible} onCheckedChange={setMapVisible} />
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{mapVisible ? "On" : "Off"}</span>
        </div>
      </div>

      {mapVisible && (
        <Card className="border-border/60">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border bg-background p-0.5">
                {([
                  { key: "leads", label: "Urgent Leads" },
                  { key: "techs", label: "Technicians" },
                  { key: "both", label: "Both" },
                ] as const).map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setViewMode(opt.key)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      viewMode === opt.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                variant={showInactiveTechs ? "default" : "outline"}
                className="h-10 text-sm sm:h-8 sm:text-xs"
                onClick={() => {
                  setShowInactiveTechs((v) => {
                    const next = !v;
                    if (next) setViewMode("techs"); // focus techs when viewing inactive
                    clearSelectedTech();
                    return next;
                  });
                }}
                title="Show deactivated technicians so you can re-activate them"
              >
                <span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-full border border-white ${showInactiveTechs ? "bg-slate-300" : "bg-slate-400"}`} />
                {showInactiveTechs ? "Viewing inactive" : "Inactive techs"}
              </Button>
              {(role === "admin" || role === "processor") && viewMode !== "leads" && (
                <Button
                  size="sm"
                  variant={multiTechSelectMode ? "default" : "outline"}
                  className="h-10 text-sm sm:h-8 sm:text-xs"
                  onClick={() => {
                    if (multiTechSelectMode) {
                      setMultiTechSelectMode(false);
                      setSelectedTechIds([]);
                    } else {
                      setMultiTechSelectMode(true);
                      setSelectedTechIds(selectedTechId ? [selectedTechId] : []);
                      setViewMode("techs");
                    }
                  }}
                  title={`Select technicians within ${RADIUS_MILES} miles of the selected technician`}
                >
                  {multiTechSelectMode ? `Selecting ${selectedTechIds.length}` : "Select nearby techs"}
                </Button>
              )}
              <MapFilterControls services={services} states={availableStates.map((code) => ({ code, name: US_STATES[code] }))}
                service={serviceFilter} state={stateFilter} onServiceChange={setServiceFilter} onStateChange={setStateFilter}
                onMenuOpen={() => setShowOmni(false)} />
              <div className="relative flex min-w-0 flex-1 basis-full items-center gap-1 sm:min-w-[240px] sm:basis-[300px]" ref={omniInputWrapRef}>
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={omniSearch}
                    onChange={(e) => { setOmniSearch(e.target.value); setShowOmni(true); }}
                    onFocus={() => { if (omniSearch.trim()) setShowOmni(true); }}
                    onBlur={() => { setTimeout(() => setShowOmni(false), 150); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        runOmniActivate();
                      } else if (e.key === "Escape") {
                        setShowOmni(false);
                      } else if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setShowOmni(true);
                        setOmniActiveIndex((i) => Math.min(i + 1, Math.max(0, omniItems.length - 1)));
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setShowOmni(true);
                        setOmniActiveIndex((i) => Math.max(i - 1, 0));
                      }
                    }}
                    placeholder="Search technician, customer, or city / ZIP / area"
                    className="h-10 w-full pl-8 pr-16 text-sm sm:h-8 sm:text-xs"
                    aria-autocomplete="list"
                    aria-expanded={showOmni}
                  />
                  {geocoding && (
                    <Loader2 className="absolute right-8 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                  {omniSearch && (
                    <button
                      type="button"
                      onClick={resetSearch}
                      aria-label="Clear search"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Button size="sm" className="h-10 text-sm sm:h-8 sm:text-xs" onClick={runOmniActivate}>Search</Button>
              </div>
              {renderOmniDropdown()}

              {multiTechSelectMode && (
                <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                  <span>{selectedTechId ? `Choose up to 8 technician pins within ${RADIUS_MILES} miles of the selected technician.` : "Click a technician pin to set the radius anchor, then choose nearby technicians."} Selected: {selectedTechIds.length}/8</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => setSelectedTechIds([])}>Clear selection</Button>
                    <Button size="sm" className="h-7" disabled={!selectedTechIds.length} onClick={() => navigate(`/technicians?workflow=${encodeURIComponent(selectedTechIds.join(","))}`)}>Open Processing Workflow</Button>
                  </div>
                </div>
              )}

              {/* Coverage tool: draw a green "good coverage" radius on click. */}
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant={coverageOn ? "default" : "outline"}
                  className="h-10 text-sm sm:h-8 sm:text-xs"
                  onClick={() => setCoverageOn((v) => !v)}
                  title="Draw a coverage radius: turn on, then click the map to drop a center"
                >
                  <span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-full border border-white ${coverageOn ? "bg-green-300" : "bg-green-500"}`} />
                  Add Coverage
                </Button>
                {coverageOn && (
                  <>
                    <Input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={coverageRadiusInput}
                      onChange={(e) => setCoverageRadiusInput(e.target.value)}
                      className="h-10 w-[68px] text-sm sm:h-8 sm:text-xs"
                      aria-label="Radius in miles for the next coverage circle"
                      title="Radius (miles) for the next circle you add"
                    />
                    <span className="text-[11px] text-muted-foreground">mi</span>
                    {coverageAreas.length > 0 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-10 px-2 text-xs sm:h-8"
                        onClick={() => void clearCoverageAreas()}
                        title="Remove all coverage circles"
                      >
                        Clear all
                      </Button>
                    ) : (
                      <span className="hidden text-[11px] text-muted-foreground sm:inline">Click the map to add a circle</span>
                    )}
                  </>
                )}
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-500 border border-white" /> Technician</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500 border border-white" /> Urgent Lead</span>
                {selectedTech && (
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-blue-500 bg-blue-500/10" /> {RADIUS_MILES}-mi radius</span>
                )}
                {coverageAreas.some((area) => area.isActive) && (
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-green-600 bg-green-500/25" /> Good coverage ({coverageAreas.filter((area) => area.isActive).length})</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {mapVisible && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          <Card className="relative isolate z-0 overflow-hidden border-border/60">
            <div ref={mapEl} className="h-[calc(100vh-320px)] min-h-[420px] w-full" />
          </Card>

          {isMobile ? (
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
                <SheetHeader><SheetTitle>Technician</SheetTitle></SheetHeader>
                <div className="pt-3">{SidePanel}</div>
              </SheetContent>
            </Sheet>
          ) : (
            <Card className="border-border/60">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-3">
                  <Contact className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Technician</span>
                </div>
                {SidePanel}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {!mapVisible && (
        <Card className="border-border/60">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Map is off. Toggle "Map View" on to see technicians and urgent leads on the map.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
