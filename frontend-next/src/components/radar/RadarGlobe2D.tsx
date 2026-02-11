"use client";

import { useCallback, useEffect, useRef } from "react";

type RadarGlobe2DProps = {
  visible?: boolean;
  ledLat?: number;
  ledLon?: number;
  useLandmask?: boolean;
  onDrawFrame?: (ms: number) => void;
  onStaticDraw?: (ms: number) => void;
  onResize?: () => void;
};

type MaskData = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

const BRASIL_CENTER = { lat: -14.235, lon: -51.9253 };
const LED_POSITION = { lat: -14.235, lon: -51.9253 };
const FPS = 12;

const degToRad = (deg: number) => (deg * Math.PI) / 180;
const radToDeg = (rad: number) => (rad * 180) / Math.PI;

const orthographicProject = (
  lat: number,
  lon: number,
  lat0: number,
  lon0: number
) => {
  const latRad = degToRad(lat);
  const lonRad = degToRad(lon);
  const lat0Rad = degToRad(lat0);
  const lon0Rad = degToRad(lon0);

  const x = Math.cos(latRad) * Math.sin(lonRad - lon0Rad);
  const y =
    Math.cos(lat0Rad) * Math.sin(latRad) -
    Math.sin(lat0Rad) * Math.cos(latRad) * Math.cos(lonRad - lon0Rad);

  return { x, y };
};

const orthographicInverse = (
  x: number,
  y: number,
  lat0: number,
  lon0: number
) => {
  const rho = Math.sqrt(x * x + y * y);
  if (rho > 1) return null;

  const c = Math.asin(rho);
  const lat0Rad = degToRad(lat0);
  const lon0Rad = degToRad(lon0);

  if (rho < 1e-6) {
    return { lat: lat0, lon: lon0 };
  }

  const lat = Math.asin(
    Math.cos(c) * Math.sin(lat0Rad) +
      (y * Math.sin(c) * Math.cos(lat0Rad)) / rho
  );
  const lon =
    lon0Rad +
    Math.atan2(
      x * Math.sin(c),
      rho * Math.cos(lat0Rad) * Math.cos(c) - y * Math.sin(lat0Rad) * Math.sin(c)
    );

  return { lat: radToDeg(lat), lon: radToDeg(lon) };
};

const sampleMask = (mask: MaskData | null, lat: number, lon: number) => {
  if (!mask) return 0;
  const u = (lon + 180) / 360;
  const v = (90 - lat) / 180;
  const x = Math.min(mask.width - 1, Math.max(0, Math.floor(u * mask.width)));
  const y = Math.min(mask.height - 1, Math.max(0, Math.floor(v * mask.height)));
  const idx = (y * mask.width + x) * 4;
  return mask.data[idx] / 255;
};

export default function RadarGlobe2D({
  visible = true,
  ledLat = LED_POSITION.lat,
  ledLon = LED_POSITION.lon,
  useLandmask = true,
  onDrawFrame,
  onStaticDraw,
  onResize
}: RadarGlobe2DProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<MaskData | null>(null);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const ledPosRef = useRef({ x: 0, y: 0 });
  const isVisibleRef = useRef(visible);
  const isActiveRef = useRef(true);
  const lastFrameRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const lastSizeRef = useRef({ width: 0, height: 0 });
  const onDrawFrameRef = useRef<RadarGlobe2DProps["onDrawFrame"]>(onDrawFrame);
  const onStaticDrawRef = useRef<RadarGlobe2DProps["onStaticDraw"]>(onStaticDraw);
  const onResizeRef = useRef<RadarGlobe2DProps["onResize"]>(onResize);

  useEffect(() => {
    isVisibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    onDrawFrameRef.current = onDrawFrame;
  }, [onDrawFrame]);

  useEffect(() => {
    onStaticDrawRef.current = onStaticDraw;
  }, [onStaticDraw]);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    const handleVisibility = () => {
      isActiveRef.current = !document.hidden && isVisibleRef.current;
    };
    handleVisibility();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const drawStaticGlobe = useCallback(() => {
    const start = performance.now();
    const { width, height, dpr } = sizeRef.current;
    if (!width || !height) return;
    const canvas = offscreenRef.current ?? document.createElement("canvas");
    offscreenRef.current = canvas;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, width, height);

    const r = Math.min(width, height) * 0.42;
    const cx = width / 2;
    const cy = height / 2;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    const gradient = ctx.createRadialGradient(
      cx - r * 0.2,
      cy - r * 0.2,
      r * 0.2,
      cx,
      cy,
      r
    );
    gradient.addColorStop(0, "rgba(255,255,255,0.08)");
    gradient.addColorStop(1, "rgba(0,0,0,0.9)");
    ctx.fillStyle = gradient;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    const step = Math.max(5, Math.round(r / 35));
    for (let y = cy - r; y <= cy + r; y += step) {
      for (let x = cx - r; x <= cx + r; x += step) {
        const nx = (x - cx) / r;
        const ny = (y - cy) / r;
        const dist2 = nx * nx + ny * ny;
        if (dist2 > 1) continue;

        const z = Math.sqrt(1 - dist2);
        const inv = orthographicInverse(nx, -ny, BRASIL_CENTER.lat, BRASIL_CENTER.lon);
        const land = inv ? sampleMask(maskRef.current, inv.lat, inv.lon) : 0;
        const base = 0.12 + z * 0.28;
        const alpha = land > 0.1 ? base * 1.5 : base * 0.45;

        ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
        ctx.fillRect(x, y, 1.2, 1.2);
      }
    }

    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    const ledProjection = orthographicProject(
      ledLat,
      ledLon,
      BRASIL_CENTER.lat,
      BRASIL_CENTER.lon
    );
    ledPosRef.current = {
      x: cx + ledProjection.x * r,
      y: cy - ledProjection.y * r
    };
    const elapsed = performance.now() - start;
    if (onStaticDrawRef.current) onStaticDrawRef.current(elapsed);
  }, [ledLat, ledLon]);

  const drawFrame = useCallback((time: number) => {
    const start = performance.now();
    const canvas = canvasRef.current;
    const offscreen = offscreenRef.current;
    const { width, height, dpr } = sizeRef.current;
    if (!canvas || !offscreen || !width || !height) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(offscreen, 0, 0, width, height);

    const t = time / 1000;
    const alpha = 0.55 + 0.35 * Math.sin(t * 2.2);
    const { x, y } = ledPosRef.current;
    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    ctx.shadowColor = "rgba(255,255,255,0.6)";
    ctx.shadowBlur = 10;
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const elapsed = performance.now() - start;
    if (onDrawFrameRef.current) onDrawFrameRef.current(elapsed);
  }, []);

  useEffect(() => {
    if (!useLandmask) {
      maskRef.current = null;
      drawStaticGlobe();
      drawFrame(performance.now());
      return;
    }
    const image = new Image();
    image.src = "/assets/globe/landmask.png";
    image.onload = () => {
      const temp = document.createElement("canvas");
      temp.width = image.width;
      temp.height = image.height;
      const ctx = temp.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, temp.width, temp.height);
      maskRef.current = {
        data: imageData.data,
        width: temp.width,
        height: temp.height
      };
      drawStaticGlobe();
      drawFrame(performance.now());
    };
    image.onerror = () => {
      console.warn("[RadarGlobe2D] landmask não carregada.");
      maskRef.current = null;
      drawStaticGlobe();
      drawFrame(performance.now());
    };
  }, [useLandmask, drawStaticGlobe, drawFrame]);

  const handleResize = useCallback(() => {
    if (resizeRafRef.current !== null) return;
    resizeRafRef.current = window.requestAnimationFrame(() => {
      resizeRafRef.current = null;
      const canvas = canvasRef.current;
      if (!canvas || !canvas.parentElement) return;
      const rect = canvas.parentElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      if (
        Math.abs(width - lastSizeRef.current.width) < 1 &&
        Math.abs(height - lastSizeRef.current.height) < 1
      ) {
        return;
      }
      lastSizeRef.current = { width, height };
      const dpr = 1;
      sizeRef.current = {
        width,
        height,
        dpr
      };
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      drawStaticGlobe();
      drawFrame(performance.now());
      if (onResizeRef.current) onResizeRef.current();
    });
  }, [drawStaticGlobe, drawFrame]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const observer = new ResizeObserver(() => handleResize());
    observer.observe(canvasRef.current.parentElement as Element);
    handleResize();
    return () => {
      observer.disconnect();
      if (resizeRafRef.current !== null) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
    };
  }, [handleResize]);

  useEffect(() => {
    if (intervalRef.current !== null) return;
    const tick = (time: number) => {
      if (!isActiveRef.current) return;
      if (time - lastFrameRef.current < 1000 / FPS) return;
      lastFrameRef.current = time;
      drawFrame(time);
    };
    intervalRef.current = window.setInterval(() => {
      if (isActiveRef.current) {
        tick(performance.now());
      }
    }, 1000 / FPS);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [drawFrame]);

  useEffect(() => {
    isActiveRef.current = !document.hidden && visible;
  }, [visible]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
}
