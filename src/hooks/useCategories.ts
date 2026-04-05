import { useState, useEffect } from 'react';

export interface CategoryConfig {
  id: number;
  name: string;
  label: string;
  emoji: string;
  color: string;
  sort_order: number;
}

const API_URL = (typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_API_URL) || 'https://garten.infinityspace42.de';

let cachedCategories: Record<string, CategoryConfig> | null = null;
let fetchPromise: Promise<Record<string, CategoryConfig>> | null = null;

const FALLBACK: Record<string, CategoryConfig> = {
  sonstiges: { id: 0, name: 'sonstiges', label: 'Sonstiges', emoji: '🔧', color: 'bg-gray-100 text-gray-800', sort_order: 99 },
};

function fetchCategories(): Promise<Record<string, CategoryConfig>> {
  if (cachedCategories) return Promise.resolve(cachedCategories);
  if (fetchPromise) return fetchPromise;

  fetchPromise = fetch(`${API_URL}/api/categories`)
    .then(res => res.json())
    .then(data => {
      const map: Record<string, CategoryConfig> = {};
      for (const cat of data.categories || []) {
        map[cat.name] = cat;
      }
      cachedCategories = map;
      return map;
    })
    .catch(() => {
      fetchPromise = null;
      return FALLBACK;
    });

  return fetchPromise;
}

export function useCategories() {
  const [categories, setCategories] = useState<Record<string, CategoryConfig>>(cachedCategories || FALLBACK);
  const [isLoading, setIsLoading] = useState(!cachedCategories);

  useEffect(() => {
    if (cachedCategories) {
      setCategories(cachedCategories);
      setIsLoading(false);
      return;
    }
    fetchCategories().then(cats => {
      setCategories(cats);
      setIsLoading(false);
    });
  }, []);

  return { categories, isLoading };
}

export function getCategoryConfig(categories: Record<string, CategoryConfig>, name: string) {
  return categories[name] || categories['sonstiges'] || FALLBACK.sonstiges;
}

export function getTaskCategories(task: { categories?: string[]; category?: string }): string[] {
  if (task.categories && task.categories.length > 0) return task.categories;
  if (task.category) return [task.category];
  return [];
}
