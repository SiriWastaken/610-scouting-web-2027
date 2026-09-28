# Stress tests

Load sized to a real event and somewhat beyond: 120 open dashboards receiving a
300-submission burst, 150 rapid edits to one record, and a 400-team,
24,000-record merge. Time limits are generous smoke bounds that catch
pathological slowdowns; they are not benchmarks.

Bursts are sent with bounded concurrency (`mapLimit`) like real tablets do. Firing
hundreds of connections in the same millisecond overflows the OS listen
backlog (128 on macOS) and would only test the laptop.
Run: `npm run test:stress`.
