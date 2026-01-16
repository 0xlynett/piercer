# Controller Tests

This directory contains tests for the Piercer controller server infrastructure.

## Test Structure

- `db.test.ts` - Tests for the database service (BunDatabase)
- `logger.test.ts` - Tests for the logging service (PinoLogger)
- `websocket.test.ts` - Tests for the WebSocket handler (WebSocketHandler)

## Running Tests

Run all tests:

```bash
bun test
```

Run specific test file:

```bash
bun test db.test.ts
```

Run tests with coverage:

```bash
bun test --coverage
```

Run tests in watch mode:

```bash
bun test --watch
```

## Test Configuration

Tests use Bun's built-in test runner and are configured to:

- Use temporary database files for isolation
- Clean up resources after each test
- Test both success and error scenarios
- Validate interface contracts and dependencies

## Dependencies

The tests use:

- `bun:test` - Built-in test runner
- Temporary SQLite databases for testing
- Mock WebSocket connections for handler testing

## Coverage

The test suite covers:

- Database operations (CRUD for agents, model mappings, pending requests)
- Logging functionality (all log levels and specialized methods)
- WebSocket handler methods and API procedures
- Error handling and edge cases
- Resource cleanup and shutdown procedures
