import Link from "next/link";

export function ProductNavigation({ page }: { page: "home" | "world" }) {
  const items = [
    { label: "World", href: page === "home" ? "#world" : "/world", current: true },
    { label: "Saved", href: page === "home" ? "#saved" : "/#saved", current: false },
    { label: "Headlines", href: page === "home" ? "#headlines" : "/#headlines", current: false },
  ];

  return (
    <nav className="product-navigation" aria-label="Possibility Atlas">
      {items.map((item, index) => (
        <span className="product-navigation-item" key={item.label}>
          {index > 0 ? <span className="product-navigation-divider" aria-hidden="true">·</span> : null}
          <Link
            href={item.href}
            className={`product-navigation-link${item.current ? " product-navigation-link-current" : ""}`}
            aria-current={item.current ? (page === "world" ? "page" : "location") : undefined}
          >
            {item.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}

export function AtlasTeachingLine() {
  return (
    <p className="atlas-teaching-line" aria-label="How Possibility Atlas works">
      <span>Freeze the facts</span>
      <span aria-hidden="true">→</span>
      <span>Branch the scenarios</span>
      <span aria-hidden="true">→</span>
      <span>Trace the ripples</span>
    </p>
  );
}
