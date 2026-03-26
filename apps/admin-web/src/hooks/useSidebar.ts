import { useState, useCallback } from 'react';

export function useSidebar(initialOpen = true) {
  const [open, setOpen] = useState(initialOpen);
  const toggle = useCallback(() => setOpen((prev) => !prev), []);
  return { open, toggle, setOpen };
}
