Hello, I am not the first one having the following problem, did not find any solution (by searching in StackOverflow.com and Google Search) and I think that its nature requires it be addressed in the Serial API.

*Situation:*

- **application:** running in Chrome browser, uses serial device as peripheral to send data out and to receive random external events
- **serial device**, two-way communication. Receives data or commands from the app, reports back either required response, or event data. Initiation of the event is external and from the point of view of the controlling application, random (unpredictable).
- **user:** works with the application. At any moment they may decide to disconnect the port and/or close the application.

`serialPort:` *SerialPort* object, open
`serialPort.readable:` _ReadableStream_, open
`reader` : _Reader_ object returned by `serialPort.readable.getReader()`

*Problem:*

- The application monitors the port in an infinite loop, with something like `{ value, done } = await reader.read()` at its core.
- Due to the fact that incoming data (events) are random, the app cannot determine whether it will read any more data or not
- when the user decides to disconnect or shutdown, the application should close the serial port.
- However, `serialPort.close()` will throw exception because `serialPort.readable` stream is locked by `reader`
- `reader.releaseLock()` will throw exception, because the reader is "busy" - it is assumed it has to receive some data because `reader.read()` call is in progress.
- As consequence of the above, there is no way to close the port - effectively, `serialPort` is in deadlock.

This would not matter in case when the app is terminated - closing Chrome window, reloading the page, loading another URL. In this case port will be somehow closed by Chrome and can be reused by another application.

However, if, for whatever reason, the app ran on but needed to close the port, it would be impossible.

*Possible solutions*:

1. **BREAK SOLUTION** Add a `SerialPort` method (e.g. `break()`) that would cause exception or other condition in `Reader` so that it can either throw exception or return `{ done: true, ... }`, making it possible to leave the infinite reading loop. I think exception would be more desirable here, but it's up to the designers to decide.  At the same time, the resulting condition should leave the port open and `serialPort.readable` still valid and ready for further use, including creating a new `Reader` when `getReader()` method is called.
2. **EVENT SOLUTION** let `SerialPort.readable` or `SerialPort` emit some kind of event ('ready', 'data' etc.) that would allow to call `reader.read()` only in case when there actually is anything to read. In this kind of situations, the application would not read the port in infinite loop (as show in the API examples) but would react to the event. Maybe I did not go through `ReadableStream` docs deep enough, but I did not find such event (isn't that strange?).