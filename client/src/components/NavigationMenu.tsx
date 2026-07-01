import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavigationMenuProps {
  location: string;
  className?: string;
  itemClassName?: string;
  activeClassName?: string;
  orientation?: "horizontal" | "vertical";
  /** Rendered when no menu is configured in the CMS for this location. */
  fallbackItems?: Array<{ label: string; url: string }>;
}

interface MenuItem {
  id: number;
  label: string;
  type: string;
  url?: string;
  target?: string;
  children?: MenuItem[];
}

function MenuItemComponent({
  item,
  itemClassName,
  activeClassName,
  orientation = "horizontal",
  depth = 0,
}: {
  item: MenuItem;
  itemClassName?: string;
  activeClassName?: string;
  orientation?: "horizontal" | "vertical";
  depth?: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const hasChildren = item.children && item.children.length > 0;

  const getUrl = () => {
    if (item.type === "custom") {
      return item.url || "#";
    }
    // For other types, construct URL based on type
    // This can be extended based on your routing structure
    return item.url || "#";
  };

  const url = getUrl();
  const target = item.target || "_self";

  if (hasChildren) {
    return (
      <li
        className={cn(
          "relative group",
          orientation === "horizontal" ? "inline-block" : "block"
        )}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
      >
        <button
          className={cn(
            "flex items-center gap-1 px-4 py-2 hover:bg-accent hover:text-accent-foreground transition-colors",
            itemClassName
          )}
          onClick={() => setIsOpen(!isOpen)}
        >
          {item.label}
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              isOpen && "rotate-180"
            )}
          />
        </button>
        {isOpen && (
          <ul
            className={cn(
              "absolute bg-background border rounded-md shadow-lg z-50",
              orientation === "horizontal"
                ? "top-full left-0 min-w-[200px]"
                : "left-full top-0 ml-2 min-w-[200px]"
            )}
          >
            {item.children!.map((child) => (
              <MenuItemComponent
                key={child.id}
                item={child}
                itemClassName={itemClassName}
                activeClassName={activeClassName}
                orientation="vertical"
                depth={depth + 1}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li
      className={cn(
        orientation === "horizontal" ? "inline-block" : "block"
      )}
    >
      {target === "_blank" || url.startsWith("http") ? (
        <a
          href={url}
          target={target}
          rel={target === "_blank" ? "noopener noreferrer" : undefined}
          className={cn(
            "block px-4 py-2 hover:bg-accent hover:text-accent-foreground transition-colors",
            itemClassName
          )}
        >
          {item.label}
        </a>
      ) : (
        <Link
          href={url}
          className={cn(
            "block px-4 py-2 hover:bg-accent hover:text-accent-foreground transition-colors",
            itemClassName
          )}
        >
          {item.label}
        </Link>
      )}
    </li>
  );
}

export default function NavigationMenu({
  location,
  className,
  itemClassName,
  activeClassName,
  orientation = "horizontal",
  fallbackItems,
}: NavigationMenuProps) {
  const { data: menuData, isLoading } = trpc.menu.getMenuWithItemsByLocation.useQuery({
    location,
  });

  if (isLoading) {
    return (
      <nav className={className}>
        <ul className={cn(orientation === "horizontal" ? "flex gap-2" : "space-y-1")}>
          <li className="px-4 py-2 text-muted-foreground">Loading...</li>
        </ul>
      </nav>
    );
  }

  const items: MenuItem[] =
    menuData?.items && menuData.items.length > 0
      ? menuData.items
      : (fallbackItems ?? []).map((item, index) => ({
          id: -(index + 1),
          label: item.label,
          type: "custom",
          url: item.url,
        }));

  if (items.length === 0) {
    return null;
  }

  return (
    <nav className={className}>
      <ul className={cn(orientation === "horizontal" ? "flex gap-2" : "space-y-1")}>
        {items.map((item) => (
          <MenuItemComponent
            key={item.id}
            item={item}
            itemClassName={itemClassName}
            activeClassName={activeClassName}
            orientation={orientation}
          />
        ))}
      </ul>
    </nav>
  );
}
