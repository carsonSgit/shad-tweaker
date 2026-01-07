import { useCallback, useRef, useState } from 'react';
import * as api from '../api/client.js';
import type { Component, Screen } from '../types/index.js';

export function useComponents() {
  const [components, setComponents] = useState<Component[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasScannedRef = useRef(false);

  const scanComponents = useCallback(async () => {
    setLoading(true);
    setError(null);
    hasScannedRef.current = true;
    const result = await api.scanComponents();
    setLoading(false);

    if (result.success && result.data) {
      setComponents(result.data.components);
    } else {
      setError(result.error?.message || 'Failed to scan components');
    }
    return result;
  }, []);

  const hasScanned = useCallback(() => hasScannedRef.current, []);

  const toggleSelection = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedPaths(new Set(components.map((c) => c.path)));
  }, [components]);

  const deselectAll = useCallback(() => {
    setSelectedPaths(new Set());
  }, []);

  const getSelectedComponents = useCallback(() => {
    return components.filter((c) => selectedPaths.has(c.path));
  }, [components, selectedPaths]);

  return {
    components,
    selectedPaths,
    loading,
    error,
    hasScanned,
    scanComponents,
    toggleSelection,
    selectAll,
    deselectAll,
    getSelectedComponents,
    setError,
  };
}

export function useNavigation(initialScreen: Screen = 'dashboard') {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const historyRef = useRef<Screen[]>([]);

  const navigate = useCallback((newScreen: Screen) => {
    setScreen((currentScreen) => {
      historyRef.current = [...historyRef.current, currentScreen];
      return newScreen;
    });
  }, []);

  const goBack = useCallback((): boolean => {
    if (historyRef.current.length > 0) {
      const prev = historyRef.current[historyRef.current.length - 1];
      historyRef.current = historyRef.current.slice(0, -1);
      setScreen(prev);
      return true;
    }
    return false;
  }, []);

  const canGoBack = historyRef.current.length > 0;

  return { screen, navigate, goBack, setScreen, canGoBack };
}
