import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { highlight } from 'cli-highlight';
import type { Component } from '../types/index.js';

interface ComponentViewProps {
  component: Component;
  onBack: () => void;
}

export function ComponentView({ component, onBack }: ComponentViewProps) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const visibleLines = 20;

  const highlightedCode = useMemo(() => {
    try {
      return highlight(component.content, {
        language: 'typescript',
        ignoreIllegals: true,
      });
    } catch {
      return component.content;
    }
  }, [component.content]);

  const lines = highlightedCode.split('\n');
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
    } else if (input === 'q' || key.escape) {
      onBack();
    }
  });

  // Extract classes from content
  const classMatches = component.content.match(/className=["']([^"']+)["']/g) || [];
  const classes = classMatches
    .map((m) => m.replace(/className=["']/, '').replace(/["']$/, ''))
    .flatMap((c) => c.split(/\s+/))
    .filter((c, i, arr) => arr.indexOf(c) === i)
    .slice(0, 10); // Show first 10 unique classes

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Text bold color="cyan">{component.name}</Text>
        <Text color="gray">{component.path}</Text>
        <Text color="gray">
          {component.metadata.lines} lines | {Math.round(component.metadata.size / 1024)}KB
        </Text>
      </Box>

      {classes.length > 0 && (
        <Box marginBottom={1} flexDirection="column">
          <Text bold>Tailwind Classes:</Text>
          <Text color="yellow" wrap="wrap">
            {classes.join(' ')}
            {classMatches.length > 10 && <Text color="gray"> ...and more</Text>}
          </Text>
        </Box>
      )}

      <Box
        flexDirection="column"
        borderStyle="single"
        paddingX={1}
        height={visibleLines + 2}
      >
        {scrollOffset > 0 && (
          <Text color="gray">↑ {scrollOffset} lines above</Text>
        )}

        {visibleContent.map((line, idx) => (
          <Box key={idx}>
            <Box width={4}>
              <Text color="gray">{scrollOffset + idx + 1}</Text>
            </Box>
            <Text>{line}</Text>
          </Box>
        ))}

        {scrollOffset + visibleLines < totalLines && (
          <Text color="gray">↓ {totalLines - scrollOffset - visibleLines} lines below</Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text color="gray">
          [↑/↓] Scroll | [PgUp/PgDn] Page | [q/Esc] Back
        </Text>
      </Box>
    </Box>
  );
}
