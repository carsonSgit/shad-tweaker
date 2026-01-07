import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { highlight } from 'cli-highlight';
import type { Component } from '../types/index.js';
import * as api from '../api/client.js';
import { THEME, SYMBOLS } from '../App.js';

interface ComponentViewProps {
  component: Component;
  onBack: () => void;
}

export function ComponentView({ component, onBack }: ComponentViewProps) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [content, setContent] = useState(component.content || '');
  const [loading, setLoading] = useState(!component.content);
  const visibleLines = 18;

  // Fetch content if not already loaded
  useEffect(() => {
    if (!component.content && component.name) {
      setLoading(true);
      api.getComponent(component.name).then((result) => {
        if (result.success && result.data) {
          setContent(result.data.content || '');
        }
        setLoading(false);
      });
    }
  }, [component.name, component.content]);

  const highlightedCode = useMemo(() => {
    if (!content) return '';
    try {
      return highlight(content, {
        language: 'typescript',
        ignoreIllegals: true,
      }) || content;
    } catch {
      return content;
    }
  }, [content]);

  const lines = (highlightedCode || '').split('\n');
  const totalLines = lines.length;
  const visibleContent = lines.slice(scrollOffset, scrollOffset + visibleLines);

  useInput((input, key) => {
    if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
    } else if (key.downArrow) {
      setScrollOffset((o) => Math.min(totalLines - visibleLines, o + 1));
    } else if (key.pageUp) {
      setScrollOffset((o) => Math.max(0, o - visibleLines));
    } else if (key.pageDown) {
      setScrollOffset((o) => Math.min(totalLines - visibleLines, o + visibleLines));
    } else if (key.escape) {
      onBack();
    }
    // Note: 'q' is handled by the global App handler
  });

  // Extract classes from content
  const classMatches = content.match(/className=["']([^"']+)["']/g) || [];
  const classes = classMatches
    .map((m) => m.replace(/className=["']/, '').replace(/["']$/, ''))
    .flatMap((c) => c.split(/\s+/))
    .filter((c, i, arr) => arr.indexOf(c) === i)
    .slice(0, 12); // Show first 12 unique classes

  // Calculate file size display
  const sizeKB = Math.round((component.metadata?.size || 0) / 1024);
  const sizeDisplay = sizeKB > 0 ? `${sizeKB}KB` : `${component.metadata?.size || 0}B`;

  return (
    <Box flexDirection="column">
      {/* Header Card */}
      <Box 
        marginBottom={1} 
        flexDirection="column" 
        borderStyle="round" 
        borderColor={THEME.secondary}
        paddingX={2}
      >
        <Box>
          <Text bold color={THEME.secondary}>{SYMBOLS.diamond} {component.name}</Text>
        </Box>
        <Box>
          <Text color={THEME.muted}>{component.path}</Text>
        </Box>
        <Box marginTop={0}>
          <Text color={THEME.muted}>{SYMBOLS.line} </Text>
          <Text color={THEME.accent}>{component.metadata?.lines || 0}</Text>
          <Text color={THEME.muted}> lines │ </Text>
          <Text color={THEME.accent}>{sizeDisplay}</Text>
          <Text color={THEME.muted}> │ </Text>
          <Text color={THEME.accent}>{classes.length}</Text>
          <Text color={THEME.muted}> classes</Text>
        </Box>
      </Box>

      {loading && (
        <Box borderStyle="round" borderColor={THEME.muted} paddingX={2} paddingY={1}>
          <Text color={THEME.success}>
            <Spinner type="dots" />
          </Text>
          <Text> Loading component content...</Text>
        </Box>
      )}

      {!loading && !content && (
        <Box borderStyle="round" borderColor={THEME.accent} paddingX={2} paddingY={1}>
          <Text color={THEME.accent}>{SYMBOLS.diamond} No content available</Text>
        </Box>
      )}

      {/* Tailwind Classes */}
      {classes.length > 0 && (
        <Box marginBottom={1} flexDirection="column">
          <Box marginBottom={0}>
            <Text color={THEME.muted}>{SYMBOLS.arrow} Tailwind Classes:</Text>
          </Box>
          <Box flexWrap="wrap">
            {classes.map((cls, idx) => (
              <Box key={idx} marginRight={1}>
                <Text color={THEME.accent}>{cls}</Text>
              </Box>
            ))}
            {classMatches.length > 12 && (
              <Text color={THEME.muted}>+{classMatches.length - 12} more</Text>
            )}
          </Box>
        </Box>
      )}

      {/* Code View */}
      {!loading && content && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={THEME.muted}
          paddingX={1}
          height={visibleLines + 2}
        >
          {scrollOffset > 0 && (
            <Box justifyContent="center">
              <Text color={THEME.muted}>↑ {scrollOffset} lines above</Text>
            </Box>
          )}

          {visibleContent.map((line, idx) => (
            <Box key={idx}>
              <Box width={5} justifyContent="flex-end" marginRight={1}>
                <Text color={THEME.muted}>{scrollOffset + idx + 1}</Text>
              </Box>
              <Text color={THEME.muted}>│</Text>
              <Text> {line}</Text>
            </Box>
          ))}

          {scrollOffset + visibleLines < totalLines && (
            <Box justifyContent="center">
              <Text color={THEME.muted}>↓ {totalLines - scrollOffset - visibleLines} lines below</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Controls */}
      <Box marginTop={1} justifyContent="center">
        <Text color={THEME.muted}>
          <Text color={THEME.secondary}>↑/↓</Text> Scroll │{' '}
          <Text color={THEME.secondary}>PgUp/PgDn</Text> Page │{' '}
          <Text color={THEME.secondary}>q/Esc</Text> Back
        </Text>
      </Box>
    </Box>
  );
}
