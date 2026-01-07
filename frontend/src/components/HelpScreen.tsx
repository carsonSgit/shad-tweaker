import { Box, Text, useInput } from 'ink';
import { SYMBOLS, THEME } from '../App.js';

interface HelpScreenProps {
  onBack: () => void;
}

export function HelpScreen({ onBack }: HelpScreenProps) {
  useInput((_input, key) => {
    if (key.escape) {
      onBack();
    }
    // 'q' handled by global App handler
  });

  const sections = [
    {
      title: 'Navigation',
      icon: '>',
      shortcuts: [
        { key: '↑ / ↓', desc: 'Navigate through lists' },
        { key: '← / →', desc: 'Switch between items (previews)' },
        { key: 'Enter', desc: 'Select / confirm action' },
        { key: 'q / Esc', desc: 'Go back / cancel' },
        { key: '?', desc: 'Show this help screen' },
      ],
    },
    {
      title: 'Component Selection',
      icon: '*',
      shortcuts: [
        { key: 'Space', desc: 'Toggle component selection' },
        { key: 'a', desc: 'Select all components' },
        { key: 'n', desc: 'Deselect all (none)' },
        { key: '/', desc: 'Search / filter components' },
      ],
    },
    {
      title: 'Actions',
      icon: '#',
      shortcuts: [
        { key: 'e', desc: 'Enter edit mode (with selection)' },
        { key: 't', desc: 'Open template manager' },
        { key: 'b', desc: 'Open backup browser' },
        { key: 'y', desc: 'Confirm and apply changes' },
      ],
    },
  ];

  const workflowSteps = [
    { step: '1', text: 'Browse and select components to modify', icon: '*' },
    { step: '2', text: 'Press "e" to enter edit mode or "t" for templates', icon: '#' },
    { step: '3', text: 'Choose quick actions or enter custom find/replace', icon: '@' },
    { step: '4', text: 'Preview all changes before applying', icon: '%' },
    { step: '5', text: 'Press "y" to apply (automatic backup created)', icon: '+' },
  ];

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color={THEME.highlight}>
          [?] Help & Keyboard Shortcuts
        </Text>
      </Box>

      {/* Shortcuts Sections */}
      <Box flexDirection="column" marginBottom={1}>
        {sections.map((section, _sectionIdx) => (
          <Box key={section.title} flexDirection="column" marginBottom={1}>
            <Box marginBottom={0}>
              <Text>{section.icon} </Text>
              <Text bold color={THEME.secondary}>
                {section.title}
              </Text>
            </Box>

            <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={2}>
              {section.shortcuts.map(({ key, desc }) => (
                <Box key={key}>
                  <Box width={12}>
                    <Text color={THEME.accent}>{key}</Text>
                  </Box>
                  <Text color={THEME.muted}>{SYMBOLS.arrow} </Text>
                  <Text>{desc}</Text>
                </Box>
              ))}
            </Box>
          </Box>
        ))}
      </Box>

      {/* Workflow */}
      <Box flexDirection="column" marginBottom={1}>
        <Box marginBottom={0}>
          <Text>{SYMBOLS.arrow} </Text>
          <Text bold color={THEME.secondary}>
            Workflow
          </Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor={THEME.primary} paddingX={2}>
          {workflowSteps.map(({ step, text, icon }) => (
            <Box key={step}>
              <Text color={THEME.primary}>{step}. </Text>
              <Text>{icon} </Text>
              <Text color={THEME.highlight}>{text}</Text>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Footer */}
      <Box>
        <Text color={THEME.muted}>Press </Text>
        <Text color={THEME.secondary}>q</Text>
        <Text color={THEME.muted}> or </Text>
        <Text color={THEME.secondary}>Esc</Text>
        <Text color={THEME.muted}> to go back</Text>
      </Box>
    </Box>
  );
}
