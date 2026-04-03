import type { SelectableItem } from '../../components';
import { SelectScreen } from '../../components';

const EDIT_RESOURCES = [
  { id: 'config-bundle', title: 'Configuration Bundle', description: 'Edit versioned component configurations' },
] as const;

const EDIT_RESOURCE_ITEMS: SelectableItem[] = EDIT_RESOURCES.map(r => ({
  ...r,
  disabled: false,
  description: r.description,
}));

export type EditResourceType = (typeof EDIT_RESOURCES)[number]['id'];

interface EditScreenProps {
  onSelect: (resourceType: EditResourceType) => void;
  onExit: () => void;
}

export function EditScreen({ onSelect, onExit }: EditScreenProps) {
  return (
    <SelectScreen
      title="Edit Resource"
      items={EDIT_RESOURCE_ITEMS}
      onSelect={item => onSelect(item.id as EditResourceType)}
      onExit={onExit}
    />
  );
}
