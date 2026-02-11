"use client";

import type { ReactNode } from "react";

export type RadarPoint = {
  id: string;
  x: number;
  y: number;
  count: number;
  intensity: number;
  neighborhood: string;
};

export type RadarPulse = {
  id: string;
  x: number;
  y: number;
};

type RadarMapProps = {
  days: 7 | 15 | 30;
  points: RadarPoint[];
  pulses: RadarPulse[];
  children?: ReactNode;
  className?: string;
  dimmed?: boolean;
  showLabel?: boolean;
};

export default function RadarMap({
  days,
  points,
  pulses,
  children,
  className,
  dimmed,
  showLabel = true
}: RadarMapProps) {
  if (process.env.NODE_ENV !== "production") {
    console.log("[RadarMap] render", {
      pointsLen: points.length,
      pulsesLen: pulses.length,
      dimmed,
      className
    });
  }

  return (
    <div
      className={`relative h-[320px] w-full overflow-hidden rounded-2xl border ${
        dimmed ? "border-transparent" : "border-zinc-800"
      } bg-black/80 ${className ?? ""}`}
    >
      <div
        className={`absolute inset-0 z-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_60%)] ${
          dimmed ? "opacity-40" : "opacity-100"
        }`}
      />
      <div
        className={`absolute inset-0 z-0 bg-[linear-gradient(145deg,rgba(255,255,255,0.06),transparent_55%)] ${
          dimmed ? "opacity-50" : "opacity-100"
        }`}
      />

      <div className="absolute inset-0 z-10 flex items-center justify-center">
        <div
          className="radar-fallback"
          style={{
            width: 220,
            height: 220,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.22)",
            boxShadow: "0 0 18px rgba(255,255,255,0.12)"
          }}
        />
        <div className="radar-globe">
          <span className="radar-brazil" />
        </div>
      </div>

      <svg
        viewBox="0 0 640 380"
        className={`absolute inset-0 z-[1] h-full w-full ${
          dimmed ? "opacity-35" : "opacity-60"
        }`}
        aria-hidden="true"
      >
        <path
          d="M98 80L165 46L260 58L324 40L396 70L468 64L544 112L592 186L560 250L520 302L430 336L338 328L266 346L200 322L150 270L110 204L78 146Z"
          fill="rgba(255,255,255,0.06)"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="2"
        />
        <path
          d="M150 150L210 120L290 140L360 120L430 150L470 210L430 260L350 280L270 270L210 230Z"
          fill="rgba(255,255,255,0.03)"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="1.5"
        />
      </svg>

      <div className="absolute inset-0 z-20">
        {points.map((point) => {
          const size = Math.min(8, Math.max(2.5, 2.5 + point.intensity * 6));
          const opacity = Math.min(0.9, Math.max(0.15, 0.2 + point.intensity * 0.7));
          const glow = Math.min(16, 6 + point.intensity * 12);
          const seed = point.id
            .split("")
            .reduce((acc, char) => acc + char.charCodeAt(0), 0);
          const delay = (seed % 10) * 0.18;
          const duration = Math.max(1.6, 2.8 - point.intensity * 1.2);
          return (
            <span
              key={point.id}
              className="absolute rounded-full radar-blink"
              style={{
                left: `${point.x}%`,
                top: `${point.y}%`,
                width: `${size}px`,
                height: `${size}px`,
                opacity,
                transform: "translate(-50%, -50%)",
                backgroundColor: "rgba(255,255,255,0.9)",
                boxShadow: `0 0 ${glow}px rgba(255,255,255,${Math.min(
                  0.65,
                  0.25 + point.intensity * 0.5
                )})`,
                animationDelay: `${delay}s`,
                animationDuration: `${duration}s`
              }}
              title={`${point.neighborhood} · ${point.count} imóveis`}
            />
          );
        })}
      </div>

      <div className="absolute inset-0 z-30">
        {pulses.map((pulse) => (
          <span
            key={pulse.id}
            className="radar-pulse absolute"
            style={{
              left: `${pulse.x}%`,
              top: `${pulse.y}%`,
              transform: "translate(-50%, -50%)"
            }}
          />
        ))}
      </div>

      {showLabel ? (
        <div
          className={`absolute left-4 top-4 z-40 text-xs uppercase tracking-[0.35em] ${
            dimmed ? "text-zinc-600/70" : "text-zinc-500"
          }`}
        >
          Radar ativo · {days} dias
        </div>
      ) : null}

      {children}

      <style jsx>{`
        .radar-globe {
          width: 220px;
          height: 220px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, ${dimmed ? 0.24 : 0.18});
          background: radial-gradient(
              circle at 30% 30%,
              rgba(255, 255, 255, ${dimmed ? 0.12 : 0.08}),
              transparent 55%
            ),
            radial-gradient(
              circle at 70% 70%,
              rgba(255, 255, 255, ${dimmed ? 0.1 : 0.06}),
              transparent 60%
            );
          box-shadow: 0 0 30px rgba(255, 255, 255, ${dimmed ? 0.14 : 0.08});
          position: relative;
          overflow: hidden;
          animation: globeSpin 24s linear infinite;
        }
        .radar-fallback {
          position: absolute;
          opacity: ${dimmed ? 0.7 : 0.5};
        }
        .radar-globe::before,
        .radar-globe::after {
          content: "";
          position: absolute;
          inset: -20%;
          border-radius: 999px;
          border: 1px dashed rgba(255, 255, 255, 0.08);
        }
        .radar-globe::after {
          inset: -35%;
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .radar-brazil {
          position: absolute;
          left: 62%;
          top: 58%;
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.8);
          box-shadow: 0 0 14px rgba(255, 255, 255, 0.55);
          animation: brazilPulse 2.4s ease-in-out infinite;
        }
        .radar-brazil::after {
          content: "";
          position: absolute;
          inset: -8px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.25);
        }
        .radar-blink {
          animation-name: radarBlink;
          animation-iteration-count: infinite;
          animation-timing-function: ease-in-out;
        }
        .radar-pulse {
          width: 12px;
          height: 12px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.7);
          box-shadow: 0 0 12px rgba(255, 255, 255, 0.6);
          animation: radarPulse 1.1s ease-out forwards;
        }
        @keyframes radarBlink {
          0% {
            opacity: 0.35;
            transform: translate(-50%, -50%) scale(0.92);
          }
          50% {
            opacity: 0.9;
            transform: translate(-50%, -50%) scale(1.05);
          }
          100% {
            opacity: 0.35;
            transform: translate(-50%, -50%) scale(0.92);
          }
        }
        @keyframes brazilPulse {
          0%,
          100% {
            transform: translate(-50%, -50%) scale(0.95);
            opacity: 0.7;
          }
          50% {
            transform: translate(-50%, -50%) scale(1.08);
            opacity: 1;
          }
        }
        @keyframes globeSpin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes radarPulse {
          0% {
            opacity: 0.9;
            transform: translate(-50%, -50%) scale(0.6);
          }
          70% {
            opacity: 0.4;
            transform: translate(-50%, -50%) scale(4);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(5);
          }
        }
      `}</style>
    </div>
  );
}
