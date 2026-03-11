### Requirement: AI intel ingest is schedulable
The system SHALL support scheduled AI intel ingest with configurable cadence and sources.

#### Scenario: Daily ingest success
- **WHEN** scheduler reaches configured run time
- **THEN** system fetches configured sources, deduplicates items, and stores normalized intel entries
- **AND** updates last run status and counts

#### Scenario: Ingest failure triggers alert
- **WHEN** scheduled ingest fails
- **THEN** system writes failure status and emits an actionable alert with error context
