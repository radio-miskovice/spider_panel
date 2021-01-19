const Serial = navigator.serial
const encoder = new TextEncoder()

const errorText = document.getElementById("error")
const textbox = document.getElementById("text")
const connectBtn = document.getElementById("connect")
const historyList = document.getElementById("history")
const spiderStatusLabel = document.getElementById("status")

let ports = []
let history = []
let connected = false
let appWpm = 20
let keyerWpm = 0

refreshHistory()

let spiderKeyer = undefined
let spiderIdText = ''
const spiderStatus = { state: '@', wpm: 0 }

function renderHistory (history) {
  const h = history.map( x => `<li>${x.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')}</li>\n`)
  return h.join('')
}

function onHistoryClick( e ) {
  const li = e.target
  const text = e.target.innerText 
  if( sendText( text ) ) {
    history = [ history[li.data], ...(history.slice(0, li.data)), ...(history.slice( li.data + 1)) ]
    refreshHistory()
  }
}

function addHistoryItem( newItem ) {
  history.unshift(newItem)
  if (history.length > 10) history.pop()
  refreshHistory()
  window.localStorage.setItem('history', JSON.stringify(history))
}

function refreshHistory() {
  historyList.innerHTML = renderHistory(history)
  const lis = historyList.children
  for ( let i = 0; i< lis.length; i++  ) {
    lis[i].ondblclick = onHistoryClick
    lis[i].data = i
  }
}
/********************************/
/* SPIDER COMMUNICATION SECTION */
/********************************/

/**
 * Send text to keyer.
 * - convert text to upper case and send over serial port
 * - report serial port errors
 * @param {string} text 
 */
function sendText ( text ) {
  if( text ) {
    resetError()
    if( spiderKeyer && spiderKeyer.writable ) {
      if( connected ) {
        const w = spiderKeyer.writable.getWriter()
        const t = (new TextEncoder()).encode(text.toUpperCase())
        w.write(t).then(() => { w.releaseLock() }).catch(e => console.log(e))
        return true
      }
      else {
        setError( "Spider Keyer not confirmed")
        return false
      }
    }
    else {
      setError("Spider Keyer not connected")
    }
  } 
  return false 
}
/**
 * Send command to the keyer
 * @param { number[] } command 
 */
async function sendSpiderCommand( command ) {
  if (spiderKeyer) {
    if (!spiderKeyer.writable) {
      setError('(Checking status) port write unavailable.')
      return false
    }
    else if( (command instanceof Array) && command.length > 0 ) {
      resetError()
      const bg = connectBtn.style.backgroundColor
      connectBtn.style.backgroundColor = '#88F'
      const writer = spiderKeyer.writable.getWriter()
      const buffer = new ArrayBuffer(command.length)
      let cmd = new Uint8Array(buffer)
      cmd.set( command, 0 )
      await writer.write(buffer)
      writer.releaseLock()
      connectBtn.style.backgroundColor = bg
      return true 
    }
  }
  return false
}

/**
 * Read keyer status (2 bytes)
 */
async function getKeyerStatus() {
  if (!(spiderKeyer && spiderKeyer.readable)) {
    setError('(Checking status) port read unavailable.')
    return -1
  }
  else {
    const reader = spiderKeyer.readable.getReader()
    try {
      let data = []
      while (true) {
        let { value, done } = await reader.read()
        if (done) {
          break;
        }
        data.push( ...value )
      }
    }
    catch (e) {
      console.log('error in read loop')
      console.log(e)
    }
    finally {
      console.log('finished read loop')
      await reader.releaseLock()
      const spiderIdLabel = document.getElementById('status')
      spiderIdLabel.innerText = spiderIdText
      spiderIdText = ''
    }
  }
}

async function getSpiderId() {
  resetError()
  if( sendSpiderCommand( [17,17] )) {
    readSpiderId()
  }
  else {
    setError('Keyer connect failed. Reload page and try again.')
    setStatus('(Keyer not connected)')
  }
}

async function readSpiderId() {
  if (spiderKeyer?.readable) {
    const reader = spiderKeyer.readable.getReader()
    try {
      while (true) {
        let { value, done } = await reader.read()
        if (done) {
          break;
        }
        let text = (new TextDecoder()).decode(value)
        for (const x of value.slice(0, 2)) {
          console.log('0x' + (x + 0x100).toString(16).slice(1) + ' ')
        }
        spiderIdText += text
        if (text.slice(text.length - 1) === ']') {
          console.log('SPIDER:', spiderIdText)
          connected = !!spiderIdText.match(/^Spider Keyer/)
          break
        }
      }
    }
    catch (e) {
      console.log('error in read loop')
      console.log(e)
    }
    finally {
      console.log('finished read loop')
      await reader.releaseLock()
      const spiderIdLabel = document.getElementById('status')
      spiderIdLabel.innerText = spiderIdText
      spiderIdText = ''
    }
  }
  else {
    setError('Cannot read data from keyer.')
  }
}

/**
 * 
 * @param {DOMEvent} e 
 */
function setSpiderSpeed(e) {
  const wpm = e.target.value || 20;
  let status = spiderStatusLabel.innerText.replace(/\].*$/, `] ${wpm} WPM`);
  sendSpiderCommand([3, wpm])
  spiderStatusLabel.innerText = status
}

/********** PORT HANDLING SECTION ************/
const disconnectPort = async (e) => {
  connected = false
  showSpeedButtons(false)
  await spiderKeyer.close()
  e.target.innerHTML = 'Connect'
  e.target.onclick = connectPort
  spiderStatusLabel.innerText = '(not connected)'
}

async function setupPort (port)  {
  spiderKeyer = port
  spiderKeyer.onconnect = (e) => { console.log('port connect: ', e) }
  spiderKeyer.ondisconnect = (e) => { console.log('port disconnect: ', e) }
  const portInfo = await spiderKeyer.getInfo()
  console.log(portInfo)
  spiderKeyer.open({ baudRate: 57600 }).then(x => {
    // connected = true // connected has to be set only after Spider has confirmed itself
    connectBtn.innerHTML = 'Disconnect'
    connectBtn.onclick = disconnectPort
    window.setTimeout(getSpiderId, 1500)
    showSpeedButtons( true )
  })
    .catch(e => setError(e))
}

async function connectPort (e) {
  if (Serial) {
    if (spiderKeyer) {
      if (!connected) setupPort(spiderKeyer)
    }
    else {
      try {
        const port = await Serial.requestPort()
        setupPort(port)
      }
      catch (e) {
        console.log(e)
      }
    }
    e.preventDefault()
  }
}

textbox.onkeypress = async (e) => {
  if (e.code === 'Enter') {
    e.preventDefault()
    if (!e.ctrlKey && !e.shiftKey && !e.metaKey) {
      let cw = e.target.value
      cw = cw.toUpperCase()
      e.target.value = ''
      sendText( cw )
      addHistoryItem( cw )
    }
  }
}

function setError(e) {
  errorText.innerHTML = e.toString()
  errorText.style.visibility = "visible"
}

function resetError(e) {
  errorText.innerHTML = ""
  errorText.style.visibility = "hidden"
}


const checkSerial = async () => {
  console.log('Document loaded')
  if (!Serial) {
    setError("This browser does not support Serial")
  }
}

function showSpeedButtons( yesNo ) {
  const bp = document.getElementById('speedPanel')
  bp.style.visibility = yesNo ? 'visible' : 'hidden'
}


function setStatus() {
  spiderStatus.state = receiveBuffer[0] & 0x38
  spiderStatus.wpm = receiveBuffer[1] & 0x3F
  const statusLabel = document.getElementById('status')
  statusLabel.innerText = char(spiderStatus.state) + ' ' + spiderStatus.wpm.toString() + ' WPM'
}

window.onload = (e) => checkSerial()
document.addEventListener('DOMContentLoaded', async () => {
  ports = await navigator.serial.getPorts();
  console.log('DOM loaded. See serial ports:')
  console.log(ports)
  let oldHistory = localStorage.getItem('history')
  if( oldHistory ) {
    history = JSON.parse(oldHistory)
    refreshHistory()
  }
  const speedButtons = document.querySelectorAll('#speedPanel > button')
  try {
    for( let b of speedButtons ) {
      b.onclick = setSpiderSpeed 
    }
  }
  catch(e) {
    setError('Unable to set button actions')
  }
  finally {
    connectBtn.onclick = connectPort
  }
});