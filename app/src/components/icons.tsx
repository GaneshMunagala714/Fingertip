import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export function PhoneIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 4h3l1.2 3.2-1.8 1.1a12 12 0 0 0 5.3 5.3l1.1-1.8 3.2 1.2v3c0 .6-.5 1.2-1.1 1.3A16 16 0 0 1 6.7 5.1C6.8 4.5 7.4 4 8 4z" />
    </svg>
  );
}

export function EndIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 15c2.8-3 11.2-3 14 0" />
      <path d="M7 14.5 5.2 17M17 14.5 18.8 17" />
    </svg>
  );
}

export function BackspaceIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 6h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-5-6 5-6z" />
      <path d="m11 10 5 5M16 10l-5 5" />
    </svg>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 8h3l1.5-2h7L17 8h3v10H4V8z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}
