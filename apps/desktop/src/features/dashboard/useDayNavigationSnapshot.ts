import { useLayoutEffect, useRef } from "react";

/** Keep one committed Day presentation until the requested day's records arrive.
 * The scope prevents holding another account, device filter or day boundary.
 * Navigation controls stay outside the snapshot so rapid date clicks still work.
 */
export function useDayNavigationSnapshot<T>(value: T, pending: boolean, scope: string) {
  const committed = useRef<{ value: T; scope: string } | null>(null);
  useLayoutEffect(() => {
    if (!pending) committed.current = { value, scope };
    else if (committed.current?.scope !== scope) committed.current = null;
  }, [pending, scope, value]);
  const holding = pending && committed.current?.scope === scope;
  return { value: holding ? committed.current!.value : value, holding };
}
