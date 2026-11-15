import { useState } from "react";

interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className = "h-6 w-6 shrink-0" }: BrandMarkProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 64 64"
      fill="none"
      className={className}
    >
      <path
        d="M21.5 34.5L19.5 38H12.5C10.2 38 9 35.4 10.6 33.7L30.8 13.5C31.8 12.5 33.1 12 34.5 12H49.5C51.7 12 53.5 13.8 53.5 16V30.5C53.5 31.9 52.9 33.2 51.9 34.2L48.1 38H41.5"
        stroke="#09090B"
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="44.5"
        cy="21"
        r="4.1"
        stroke="#09090B"
        strokeWidth="4.4"
      />
      <path
        d="M51.8 13.7L47.5 18"
        stroke="#09090B"
        strokeWidth="4.4"
        strokeLinecap="round"
      />
      <path
        d="M15 44.5L24.5 54C25.8 55.3 27.9 55.3 29.2 54L32.5 50.7"
        stroke="#2563EB"
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M22.5 36.5L25.5 44.5L30.5 24.5L39 53.5L43.5 44.5H55"
        stroke="#2563EB"
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrandHeroLogo() {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <div className="mb-3 flex flex-col items-center justify-center">
      {!imageFailed ? (
        <img
          src={`${import.meta.env.BASE_URL}logo.webp`}
          alt="PricePulse"
          className="h-36 w-36 object-contain sm:h-40 sm:w-40"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="mb-4 flex flex-col items-center gap-2">
          <BrandMark className="h-14 w-14" />
          <span className="text-[26px] font-bold tracking-tight text-zinc-950">
            PricePulse
          </span>
        </div>
      )}
      {!imageFailed && <span className="sr-only">PricePulse</span>}
    </div>
  );
}
