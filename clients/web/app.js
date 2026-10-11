/* tiny-agent Web GUI (phase 7).
 *
 * Speaks the same protocol as the CLI over WebSocket: it sends AgentCommands
 * and renders AgentEvents. It depends on no server/core code, only the wire
 * protocol. Open with `?session=<id>` to attach to an existing session.
 */
(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var requestedSession = params.get('session') || '';
  var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  var url = protocol + '//' + window.location.host;

  var statusEl = document.getElementById('status');
  var sessionEl = document.getElementById('session');
  var logEl = document.getElementById('log');
  var form = document.getElementById('composer');
  var input = document.getElementById('input');

  var sessionId = '';
  var socket = null;
  var streaming = null; // { id, el } while an assistant message streams in
  var busy = false;

  function connect() {
    socket = new WebSocket(url);

    socket.addEventListener('open', function () {
      statusEl.textContent = 'connected';
      if (requestedSession) {
        send({ type: 'session.attach', payload: { sessionId: requestedSession } });
      } else {
        send({ type: 'session.create', payload: {} });
      }
    });

    socket.addEventListener('message', function (message) {
      var event;
      try {
        event = JSON.parse(message.data);
      } catch (error) {
        return;
      }
      handleEvent(event);
    });

    socket.addEventListener('close', function () {
      statusEl.textContent = 'disconnected — reconnecting…';
      window.setTimeout(connect, 1000);
    });

    socket.addEventListener('error', function () {
      statusEl.textContent = 'connection error';
    });
  }

  function send(command) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(command));
    }
  }

  function handleEvent(event) {
    if (event.type === 'session.created' || event.type === 'session.attached') {
      sessionId = event.payload.sessionId;
      sessionEl.textContent = 'session: ' + sessionId;
    }
    if (event.type === 'turn.started') {
      busy = true;
    } else if (
      event.type === 'turn.completed' ||
      event.type === 'turn.interrupted' ||
      event.type === 'error'
    ) {
      busy = false;
    }
    render(event);
  }

  function render(event) {
    // Streaming text accumulates in one bubble until the message completes.
    if (event.type === 'message.delta') {
      appendDelta(event.payload.messageId, event.payload.text);
      return;
    }

    if (event.type === 'message.completed') {
      if (streaming && streaming.id === event.payload.messageId) {
        streaming.el.textContent = event.payload.content;
        streaming = null;
        scrollLog();
        return;
      }
      streaming = null;
      appendLine('event--message-completed', format(event));
      return;
    }

    streaming = null;
    appendLine('event--' + event.type.replace('.', '-'), format(event));
  }

  function appendDelta(messageId, text) {
    if (!streaming || streaming.id !== messageId) {
      var el = document.createElement('div');
      el.className = 'event event--assistant';
      logEl.appendChild(el);
      streaming = { id: messageId, el: el };
    }
    streaming.el.textContent += text;
    scrollLog();
  }

  function appendLine(className, text) {
    var line = document.createElement('div');
    line.className = 'event ' + className;
    line.textContent = text;
    logEl.appendChild(line);
    scrollLog();
  }

  function scrollLog() {
    logEl.scrollTop = logEl.scrollHeight;
  }

  function format(event) {
    var payload = event.payload || {};
    switch (event.type) {
      case 'session.created':
        return '[session] created ' + payload.sessionId;
      case 'session.attached':
        return '[session] attached ' + payload.sessionId;
      case 'user.message':
        return 'you> ' + payload.text;
      case 'turn.started':
        return '[turn] ' + payload.goal;
      case 'turn.completed':
        return '[turn] completed';
      case 'turn.interrupted':
        return '[turn] interrupted';
      case 'message.delta':
        return payload.text;
      case 'message.completed':
        return '[agent] ' + payload.content;
      case 'tool.started':
        return '[tool] ' + payload.tool + ' ' + JSON.stringify(payload.args);
      case 'tool.finished':
        return payload.error !== undefined
          ? '[tool] ' + payload.tool + ' error: ' + payload.error
          : '[tool] ' + payload.tool + ' -> ' + JSON.stringify(payload.result);
      case 'approval.requested':
        return '[approval] requested ' + payload.tool;
      case 'approval.resolved':
        return '[approval] ' + (payload.approved ? 'approved' : 'denied');
      case 'error':
        return '[error] ' + payload.message;
      case 'queue_update':
        return '[queue] steering=' + JSON.stringify(payload.steering);
      default:
        return '[' + event.type + ']';
    }
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text || !sessionId) {
      return;
    }
    if (busy) {
      send({ type: 'steer', payload: { sessionId: sessionId, text: text } });
    } else {
      send({ type: 'message.send', payload: { sessionId: sessionId, text: text } });
    }
    input.value = '';
  });

  connect();
})();
