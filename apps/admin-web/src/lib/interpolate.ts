export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  // Cataloagele folosesc două convenții de placeholder. Le susținem pe ambele,
  // identic cu apps/mobile/src/lib/i18n.tsx:
  //  1. {{param}} — înlocuit cu valoarea, sau '' când lipsește (comportament vechi).
  //  2. {param}   — înlocuit cu valoarea; LĂSAT NEATINS când nu există parametru
  //     corespunzător, ca acoladele literale (settings.organization.accessCodeHint
  //     conține un '{slug}' care e text, nu placeholder) să nu fie distruse.
  // Trecerea dublă rulează prima, ca {{param}} să fie complet consumat.
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, k) => (params[k] != null ? String(params[k]) : ''))
    .replace(/\{(\w+)\}/g, (match, k) => (params[k] != null ? String(params[k]) : match));
}
