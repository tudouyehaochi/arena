### Requirement: Role presets are versioned and syncable
The system SHALL maintain a versioned role preset baseline and support explicit sync actions.

#### Scenario: Merge missing presets
- **WHEN** admin triggers preset sync in `merge_missing` mode
- **THEN** only missing preset roles are created
- **AND** existing customized roles remain unchanged

#### Scenario: Apply all presets
- **WHEN** admin confirms `apply_all` mode
- **THEN** system updates all preset-managed roles to the target preset version
- **AND** sync result returns changed role count and version
