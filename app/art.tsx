export function Animal({
  kind = "fox",
  size = 80,
}: {
  kind?: string;
  size?: number;
}) {
  const bear = kind === "bear";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="60" cy="60" r="56" fill={bear ? "#f9e8ca" : "#e4efef"} />
      {bear ? (
        <>
          <circle cx="32" cy="35" r="16" fill="#b5855c" />
          <circle cx="88" cy="35" r="16" fill="#b5855c" />
        </>
      ) : (
        <>
          <path d="M27 52 25 17 51 35M69 35 95 17 93 52" fill="#d99b66" />
          <path d="m32 36 1-10 12 13M77 39l12-13-1 10" fill="#f3d5b8" />
        </>
      )}
      <ellipse
        cx="60"
        cy="65"
        rx="39"
        ry="36"
        fill={bear ? "#bd926b" : "#dfaa79"}
      />
      <path
        d="M22 60q38 6 38 31Q60 66 98 60c-1 28-20 38-38 38S23 85 22 60"
        fill="#fff6e6"
      />
      <circle cx="44" cy="61" r="3.5" fill="#324a43" />
      <circle cx="76" cy="61" r="3.5" fill="#324a43" />
      <ellipse cx="60" cy="76" rx="5" ry="4" fill="#324a43" />
      <path
        d="M60 81v3m-6 0q6 7 12 0"
        stroke="#324a43"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <ellipse cx="35" cy="73" rx="7" ry="4" fill="#eeafa0" />
      <ellipse cx="85" cy="73" rx="7" ry="4" fill="#eeafa0" />
    </svg>
  );
}
export function Island() {
  return (
    <svg viewBox="0 0 600 280" className="island-art" aria-hidden="true">
      <defs>
        <linearGradient id="sea" x2="0" y2="1">
          <stop stopColor="#d7eeeb" />
          <stop offset="1" stopColor="#a8d9dc" />
        </linearGradient>
      </defs>
      <ellipse
        cx="330"
        cy="231"
        rx="231"
        ry="27"
        fill="#a5d2d1"
        opacity=".32"
      />
      <ellipse cx="326" cy="220" rx="197" ry="26" fill="url(#sea)" />
      <path
        d="M174 190q28-38 67-39 33-13 73-4 45-28 83 8 53 10 79 42-30 41-150 43-123-2-152-50"
        fill="#c6a984"
      />
      <ellipse cx="324" cy="185" rx="160" ry="43" fill="#93c2a0" />
      <path
        d="M183 188q75-56 133-9t143 4q-22 39-129 36-112 1-147-31"
        fill="#bad6ab"
      />
      <path
        d="M302 153q-61 22-10 40t29 37"
        stroke="#f6e5ba"
        strokeWidth="15"
        fill="none"
      />
      <path d="M342 150v-48h68v48" fill="#f9ebca" />
      <path d="m331 108 45-39 45 39" fill="#da9b78" />
      <rect x="365" y="124" width="19" height="30" rx="9" fill="#7a9f8f" />
      <rect x="392" y="118" width="10" height="12" rx="2" fill="#b5d6cf" />
      <path d="M233 158v-52" stroke="#8eaa82" strokeWidth="9" />
      <circle cx="230" cy="106" r="29" fill="#78a890" />
      <circle cx="211" cy="117" r="23" fill="#83b299" />
      <circle cx="250" cy="123" r="22" fill="#82b093" />
      <path d="M438 165v-30" stroke="#839c77" strokeWidth="6" />
      <circle cx="438" cy="124" r="22" fill="#779f83" />
      <path
        d="m305 75 5 10 12 2-8 8 2 12-11-6-10 6 2-12-8-8 11-2z"
        fill="#eec26c"
      />
      <path d="m464 57 4 8 9 1-6 6 1 9-8-4-8 4 2-9-7-6 9-1z" fill="#eac57d" />
      <path
        d="M137 91h61q0-17-17-17-8-20-25-8-18-3-19 25M390 43h67q-4-20-23-15-15-20-28 1-17-3-16 14"
        fill="#fff"
        opacity=".8"
      />
      <circle cx="177" cy="145" r="5" fill="#f5d7a2" />
      <circle cx="409" cy="184" r="5" fill="#f8db9b" />
      <path d="m263 161 6-12 6 12z" fill="#f0bc88" />
    </svg>
  );
}
