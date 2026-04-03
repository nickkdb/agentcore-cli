import { EditConfigBundleFlow } from '../config-bundle/EditConfigBundleFlow';
import type { EditResourceType } from './EditScreen';
import { EditScreen } from './EditScreen';
import React, { useState } from 'react';

type FlowState = { name: 'select' } | { name: 'config-bundle' };

interface EditFlowProps {
  isInteractive?: boolean;
  onExit: () => void;
  onBack: () => void;
  onDev?: () => void;
  onDeploy?: () => void;
  initialResourceType?: EditResourceType;
}

export function EditFlow({
  isInteractive = true,
  onExit,
  onBack,
  onDev,
  onDeploy,
  initialResourceType,
}: EditFlowProps) {
  const getInitialState = (): FlowState => {
    if (!initialResourceType) return { name: 'select' };
    switch (initialResourceType) {
      case 'config-bundle':
        return { name: 'config-bundle' };
      default:
        return { name: 'select' };
    }
  };

  const [flow, setFlow] = useState<FlowState>(getInitialState);

  const handleSelectResource = (resourceType: EditResourceType) => {
    switch (resourceType) {
      case 'config-bundle':
        setFlow({ name: 'config-bundle' });
        break;
    }
  };

  if (flow.name === 'select') {
    return <EditScreen onSelect={handleSelectResource} onExit={onBack} />;
  }

  if (flow.name === 'config-bundle') {
    return (
      <EditConfigBundleFlow
        isInteractive={isInteractive}
        onExit={onExit}
        onBack={() => setFlow({ name: 'select' })}
        onDev={onDev}
        onDeploy={onDeploy}
      />
    );
  }

  return null;
}
