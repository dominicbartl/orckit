import { type JSX } from 'solid-js';

type IconProps = JSX.SvgSVGAttributes<SVGSVGElement>;

function Base(props: IconProps & { children: JSX.Element }) {
  const { children, ...rest } = props;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconRestart = (props: IconProps) => (
  <Base {...props}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
  </Base>
);

export const IconStop = (props: IconProps) => (
  <Base {...props}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </Base>
);

export const IconPlay = (props: IconProps) => (
  <Base {...props}>
    <path d="M7 5l12 7-12 7V5z" fill="currentColor" stroke="none" />
  </Base>
);

export const IconChevron = (props: IconProps) => (
  <Base {...props}>
    <path d="M9 6l6 6-6 6" />
  </Base>
);

export const IconCheck = (props: IconProps) => (
  <Base {...props}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Base>
);

export const IconAlert = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 4l10 17H2L12 4z" />
    <path d="M12 11v4" />
    <path d="M12 18.2v.1" />
  </Base>
);

export const IconClose = (props: IconProps) => (
  <Base {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Base>
);

export const IconCopy = (props: IconProps) => (
  <Base {...props}>
    <rect x="9" y="9" width="11" height="11" rx="1.5" />
    <path d="M5 15V5a1 1 0 0 1 1-1h10" />
  </Base>
);

export const IconSearch = (props: IconProps) => (
  <Base {...props}>
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-4-4" />
  </Base>
);

export const IconLogs = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 6h16M4 12h10M4 18h16" />
  </Base>
);

export const IconGraph = (props: IconProps) => (
  <Base {...props}>
    <circle cx="6" cy="6" r="2" />
    <circle cx="18" cy="6" r="2" />
    <circle cx="12" cy="18" r="2" />
    <path d="M7.5 7.5L11 16.5" />
    <path d="M16.5 7.5L13 16.5" />
  </Base>
);

export const IconSettings = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </Base>
);
