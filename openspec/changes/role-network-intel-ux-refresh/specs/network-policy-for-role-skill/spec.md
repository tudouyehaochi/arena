### Requirement: Network access is policy-governed
The system SHALL enforce network access through global, role-level, and skill-level policy composition.

#### Scenario: Role denied by policy
- **WHEN** global policy allows network but a role policy is set to `deny`
- **THEN** the role cannot perform network requests even if a skill requests it

#### Scenario: Domain allowlist enforced
- **WHEN** a role/skill has effective network allow
- **AND** target domain is not in `allowedDomains`
- **THEN** request is blocked and an audit record is written
