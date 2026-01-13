# DB-First Technical Patterns

## Critical Patterns for Stability

### A) Idempotency (Critical)

**Principle**: Use `file_hash` as the "do not reprocess" key.

#### For Work Orders
- **Unique constraint**: `(workspace_id, source_type, file_hash)`
- **Behavior**: If the same email/PDF gets processed twice:
  1. Detect existing source row by `file_hash`
  2. Skip creating a new work order
  3. Return the existing work order ID

#### For Signed Documents
- **Unique constraint**: `(workspace_id, file_hash)`
- **Behavior**: Same as work orders - detect existing by `file_hash` and skip reprocessing

**Implementation Notes**:
- `file_hash` is SHA-256 of the PDF buffer
- If no PDF buffer (e.g., manual entry), hash the work order number + source metadata
- Always check `work_order_sources` or `signed_documents` by `file_hash` BEFORE creating new records
- Use database unique constraints as the final safety net

### B) Conditional Uniqueness for Work Order Numbers

**Principle**: Enforce uniqueness only when extraction confidence is high.

#### When to Enforce
- **Enforce**: When FM profile has `wo_number_region` configured AND extraction confidence is high
- **Don't enforce**: When FM profile is missing OR confidence is low

#### Implementation Strategy
```typescript
// Pseudo-code
if (fmProfile?.wo_number_region && extractionConfidence >= 0.8) {
  // Enforce unique (workspace_id, fm_profile_id, work_order_number)
  // If duplicate found, route to NEEDS_REVIEW
} else {
  // Don't enforce - allow duplicates, rely on file_hash for deduplication
  // Store as NEEDS_REVIEW if ambiguous
}
```

**Current Status**: 
- Not yet implemented - currently relying on `file_hash` only
- Future enhancement: Add conditional unique constraint based on FM profile completeness

### C) Export Jobs Need Backoff

**Principle**: Sheets quota errors are normal - handle gracefully with exponential backoff.

#### Error Handling
- **Quota Errors**: Treat as `FAILED_QUOTA` (not permanent failure)
- **Backoff Strategy**: Exponential with caps
  - Attempt 1: 5 minutes
  - Attempt 2: 15 minutes  
  - Attempt 3: 1 hour
  - Attempt 4: 6 hours
  - Attempt 5+: 24 hours (max)

#### Implementation
```typescript
const backoffDelays = [5 * 60, 15 * 60, 60 * 60, 6 * 60 * 60, 24 * 60 * 60]; // seconds
const delay = backoffDelays[Math.min(attempts - 1, backoffDelays.length - 1)] * 1000;
next_retry_at = now + delay;
```

**Current Implementation**: 
- Uses exponential backoff: `BASE_RETRY_DELAY_MS * Math.pow(2, attempts - 1)`
- Stops processing on quota errors (prevents hammering API)
- Needs enhancement: Use capped exponential backoff as specified above

### D) Stop Doing "Read-Modify-Write" on Sheets

**Principle**: Prefer batch operations and avoid per-row reads.

#### Anti-Patterns (Avoid)
- ❌ Read row → Modify → Write row (per work order)
- ❌ Check if row exists → Insert or Update (per work order)
- ❌ Multiple API calls per work order

#### Preferred Patterns
- ✅ Batch updates (update multiple rows in one call)
- ✅ Append once (append all new rows in one call)
- ✅ Use `updateWorkOrderRecordPartial` only when necessary
- ✅ Prefer inserts over upserts when possible

**Current Implementation**:
- Uses `updateWorkOrderRecordPartial` which may do read-modify-write
- **Needs improvement**: Implement batch append/update operations
- **Note**: Since DB is authoritative, Sheets failures are non-blocking, but we should still optimize

## Implementation Checklist

### ✅ Completed
- [x] File hash deduplication for work orders
- [x] File hash deduplication for signed documents
- [x] Export job queue with retry mechanism
- [x] Non-blocking DB writes (shadow writes)

### 🔄 Needs Enhancement
- [ ] Conditional uniqueness for work order numbers (based on FM profile + confidence)
- [ ] Capped exponential backoff for export jobs (5m, 15m, 1h, 6h, 24h)
- [ ] Batch operations for Sheets export (avoid read-modify-write)

### 📝 Future Considerations
- [ ] Add `fm_profile_id` foreign key to work_orders table
- [ ] Add `extraction_confidence` field to work_orders table
- [ ] Implement batch append for new work orders
- [ ] Implement batch update for existing work orders

## Key Takeaways

1. **Idempotency is non-negotiable**: Always check `file_hash` before processing
2. **Quota errors are expected**: Handle gracefully with backoff, don't fail permanently
3. **DB is authoritative**: Sheets failures should never break ingestion
4. **Optimize for batch operations**: Reduce API calls to Sheets to prevent quota issues
