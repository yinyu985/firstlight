export function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]")
  ).filter((element) => {
    if (element.tabIndex < 0 || element.closest("[inert]")) return false;
    for (let current: HTMLElement | null = element; current && current !== container; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (current.hidden || style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  });
}
