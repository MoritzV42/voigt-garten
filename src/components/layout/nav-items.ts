/**
 * Zentrale Navigation-Konfiguration für Voigt-Garten.
 * Definiert alle Sektionen, Items und Icons.
 */

import type { LucideIcon } from "lucide-react";
import {
  Home,
  TreePine,
  Camera,
  Map,
  Mountain,
  CalendarDays,
  Briefcase,
  ClipboardList,
  Package,
  Menu,
  HelpCircle,
  LogIn,
  LogOut,
  Shield,
  Globe,
} from "lucide-react";

export type IconName =
  | "home"
  | "tree-pine"
  | "camera"
  | "map"
  | "mountain"
  | "calendar-days"
  | "briefcase"
  | "clipboard-list"
  | "package"
  | "menu"
  | "help-circle"
  | "log-in"
  | "log-out"
  | "shield"
  | "globe";

export const ICON_MAP: Record<IconName, LucideIcon> = {
  home: Home,
  "tree-pine": TreePine,
  camera: Camera,
  map: Map,
  mountain: Mountain,
  "calendar-days": CalendarDays,
  briefcase: Briefcase,
  "clipboard-list": ClipboardList,
  package: Package,
  menu: Menu,
  "help-circle": HelpCircle,
  "log-in": LogIn,
  "log-out": LogOut,
  shield: Shield,
  globe: Globe,
};

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/** Alle Sektionen der Sidebar-Navigation */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Erkunden",
    items: [
      { href: "/", label: "Start", icon: "home" },
      { href: "/ueber-den-garten", label: "Der Garten", icon: "tree-pine" },
      { href: "/galerie", label: "Galerie", icon: "camera" },
      { href: "/gartenkarte", label: "Karte", icon: "map" },
      { href: "/umgebung", label: "Umgebung", icon: "mountain" },
    ],
  },
  {
    title: "Buchen & Mitmachen",
    items: [
      { href: "/buchen", label: "Buchen", icon: "calendar-days" },
      { href: "/jobs", label: "Jobs", icon: "briefcase" },
    ],
  },
  {
    title: "Verwaltung",
    items: [
      { href: "/taskmanagement", label: "Aufgaben", icon: "clipboard-list" },
      { href: "/inventar", label: "Inventar", icon: "package" },
    ],
  },
];

/** Die 4 wichtigsten Items für die Mobile Bottom-Nav */
export const BOTTOM_NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Start", icon: "home" },
  { href: "/galerie", label: "Galerie", icon: "camera" },
  { href: "/buchen", label: "Buchen", icon: "calendar-days" },
  { href: "/gartenkarte", label: "Karte", icon: "map" },
];

/** Alle Items flach (für "Mehr"-Drawer) */
export function getAllItems(): NavItem[] {
  return NAV_SECTIONS.flatMap((s) => s.items);
}
