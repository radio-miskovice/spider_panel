const Serial = navigator.serial
const encoder = new TextEncoder()

const asideArea = document.getElementById("side")
const errorText = document.getElementById("error")
const sidetoneLabel = document.getElementById("freq")
const textbox = document.getElementById("text")
const connectBtn = document.getElementById("connect")
const historyList = document.getElementById("history")
const sidetoneControl = document.getElementById("sidetone")
const sidetoneAutoBtn = document.getElementById("sidetoneActionAuto")
const sidetonePaddleBtn = document.getElementById("sidetoneActionPaddle")
const spiderStatusLabel = document.getElementById("status")
const spiderIdLabel = document.getElementById("keyerId")
const sendCustomBtn = document.getElementById("sendCustomCommand")
const wpmLabel = document.getElementById("wpmLabel")
const wpmControl = document.getElementById("wpmControl")
const cmd1 = document.getElementById("cmd1")
const cmd2 = document.getElementById("cmd2")
const cmdEsc = document.getElementById("immy")

/*** Serial port globals ***/
let spiderKeyer = undefined
let spiderInput = undefined
let keepReading = false 
let connected = false
let awaitingConnect = false
let spiderIdText = ''
let statusCount = 0 

let ports = []
let history = []
let appWpm = 20
let keyerWpm = 0
let lastCommand = 0
const statusBuffer = new ArrayBuffer(2)
let status = new Uint8Array( statusBuffer )
let receiveMode = 0

refreshHistory()

/**
 * Utility function
 * @param {uint8_t} byte 
 */
function hex( byte ) {
  while( byte < 0 ) byte += 256
  return '0x' + (byte + 0x100).toString(16).slice(1)
}

/**
 * 
 * @param {*} status 
 */
function updateStatus( status ) {
  const st = status[0] + 256*status[1] ;
  console.log( 'Spider Keyer Status = ', status[0].toString(2), ": ", hex(status[0]), hex(status[1]))
  const ptt = (st & 0x10) ? 'ON' : 'OFF'
  const key = (st & 0x08) ? 'ON' : 'OFF'
  const bfr = (st & 0x20) ? 'chars' : 'empty'
  const pdbreak = ( st & 4 ) ? ' - PADDLE BREAK - ' : ''
  const txt = `[${statusCount++}] PTT ${ptt} - KEY ${key} - BUFFER ${bfr} - SPEED ${status[1]} WPM${pdbreak}`
  if( status[1] > 0 ) {
    wpmControl.value = status[1] ;
    wpmLabel.innerHTML = (status[1]).toString();
  }
  console.log(txt); 
  spiderStatusLabel.innerHTML = txt ;
}

/**
 * 
 * @param {*} history 
 */
function renderHistory (history) {
  const h = history.map( x => `<li>${x.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')}</li>\n`)
  return h.join('')
}

function onSidetoneChange( e ) {
  const v = e.target.value ;
  if(v) {
    sidetoneLabel.innerHTML = v.toString();
  }
}

/**
 * 
 * @param {DOMEvent} e 
 */
function setSpiderPitch(e) {
  const cmd = parseInt(e.target.value);
  const hz = parseInt(sidetoneControl.value) / 10 ; 
  if( hz > 30 && hz < 255 ) {
    sendSpiderCommand([27, cmd, hz])
  }
}

/**
 * 
 * @param {*} e 
 */
function onHistoryClick( e ) {
  const li = e.target
  const text = e.target.innerText 
  if( sendText( text ) ) {
    history = [ history[li.data], ...(history.slice(0, li.data)), ...(history.slice( li.data + 1)) ]
    refreshHistory()
  }
}

/**
 * 
 * @param {*} newItem 
 */
function addHistoryItem( newItem ) {
  history.unshift(newItem)
  if (history.length > 10) history.pop()
  refreshHistory()
  window.localStorage.setItem('history', JSON.stringify(history))
}

/**
 * 
 */
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
 * Wrapper to open serial port of Spider Keyer 
 * If the port is not connected yet, request it first
 * Once the port object is acquired, call setupPort()
 * which actually opens the port and performs other initiation
 * @param {DOMEvent} e - not used
 */
async function connectPort(e) {
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

/**
 * Disconnect the port and modify GUI accordingly
 * @param {DOMEvent} e 
 */
const disconnectPort = async (e) => {
  connected = false
  showSpeedButtons(false)
  keepReading = false  // tell the reading loop to terminate on the next event
  await spiderInput.cancel() // this should break the reading loop
  // after cancel(), readable stream should be unlocked and ready to close
  // check if we need to wait for readyToClose or not
  await spiderKeyer.close()
  e.target.innerHTML = 'Connect'
  e.target.onclick = connectPort
  asideArea.classList.remove('connected')
  spiderStatusLabel.innerText = '(not connected)'
}

async function setupPort(port) {
  spiderKeyer = port
  spiderKeyer.onconnect = (e) => { console.log('port connect: ', e) }
  spiderKeyer.ondisconnect = (e) => { console.log('port disconnect: ', e) }
  const portInfo = await spiderKeyer.getInfo()
  console.log(portInfo)
  try {
    await spiderKeyer.open({ baudRate: 57600 })
    afterPortOpen()
  }
  catch (e) { setError(e) }
}

function afterPortOpen() {
  asideArea.classList.add('connected')
  connectBtn.innerHTML = 'Disconnect'
  connectBtn.onclick = disconnectPort
  window.setTimeout(getSpiderId, 1500)
  showSpeedButtons(true)
  keepReading = true
  spiderReadLoop()
}

/**
 * Spider Keyer reading loop
 * Continually reads data from serial port.
 * Global variable (keepReading == true) enables the reading loop, otherwise the function returns
 * Reader object is available in global variable spiderInput, to give the app
 * a chance to terminate reading by calling spiderInput.cancel()
 * Otherwise it would be impossible to break the read() method
 */
async function spiderReadLoop() {
  while (spiderKeyer && spiderKeyer.readable && keepReading) {
    spiderInput = spiderKeyer.readable.getReader()
    try {
      while (true) {
        const { value, done } = await spiderInput.read()
        if (done) break;
        else {
          processSpiderData(value)
        }
      }
    }
    catch (e) {
      console.log(e)
    }
    finally {
      spiderInput.releaseLock()
    }
  }
}

/**
 * Event listener to receive data
 */
function processSpiderData(chunk) {
  let data = [...(new Uint8Array(chunk))]
  while (data.length > 0) {
    switch (receiveMode) {
      case 0:
        if (data[0] < 0x80) {  // reading text
          const mark = data.findIndex( x => x == ']'.charCodeAt(0)) // where is ']'
          const tail = (mark < 0) ? data.length : mark + 1
          // TODO: look for invalid characters between index 0 and tail-1
          const textBuffer = new ArrayBuffer( tail )
          const u = new Uint8Array( textBuffer )
          u.set( data.slice(0, tail))
          const text = (new TextDecoder()).decode(u)
          data = data.slice(tail)
          spiderIdText += text
          if (spiderIdText[spiderIdText.length - 1] == ']') {
            spiderIdLabel.innerText = spiderIdText
            if (awaitingConnect) {
              awaitingConnect = false
              if (spiderIdText.match(/Spider Keyer/)) connected = true
              else connected = false
            }
            spiderIdText = ''
          }
        }
        else {
          status[0] = data.shift()
          receiveMode = 0x80
        }
        break;
      case 0x80:
        status[1] = data.shift()
        updateStatus(status)
        receiveMode = 0
        break;
      default:
    }
  }
}

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
        getSpiderId()
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

async function getSpiderId() {
  resetError()
  if( sendSpiderCommand( [27, 17, 0, 27, 19, 1] )) {
    awaitingConnect = true
    spiderIdText = ''
  }
  else {
    setError('Keyer connect failed. Reload page and try again.')
    setStatus('(Keyer not connected)')
  }
}

function sendCustomCommand() {
  resetError()
  let b1 = parseInt(cmd1.value)
  let b2 = parseInt(cmd2.value)
  if((b1 | b1 == 0) && (b2 | b2==0)) {
    let command = []
    if (cmdEsc.checked) command.push(27)
    command.push(b1)
    command.push(b2)
    sendSpiderCommand( command )
  }
}

/**
 * 
 * @param {DOMEvent} e 
 */
function setSpiderSpeed(e) {
  const cmd  = e.target.value ;
  if( cmd == "PC" ) { // set wpm speed from PC
    const wpm = parseInt(wpmControl.value) ;
    if( wpm > 0 && wpm < 255) {
      sendSpiderCommand([27, 3, wpm]);
    }
  }
  else if (cmd == "SK") {
    sendSpiderCommand([27, 3, 255]);
  }
}

/**
 *
 * @param {DOMEvent} e
 */
function sendButtonCommand(e) {
  const val = parseInt(e.target.value) ;
  if( val >= 0 ) {
    const b1 = val & 255 ; // lower byte 
    const b2 = val >> 8 ;  // higher byte
    sendSpiderCommand( [27, b1, b2 ]);
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
}

function onSwitchChange( e ) {
  const cmd = parseInt(e.target.value) ;
  const state = e.target.checked ? 1 : 0 ;
  if( cmd != undefined )
  sendSpiderCommand([27, cmd, state])
}

window.onload = (e) => checkSerial()
document.addEventListener('DOMContentLoaded', async () => {
  console.log(navigator.userAgent)
  ports = await navigator.serial.getPorts();
  console.log('DOM loaded. See serial ports:')
  console.log(ports)
  let oldHistory = localStorage.getItem('history')
  if( oldHistory ) {
    history = JSON.parse(oldHistory)
    refreshHistory()
  }

  // activate pitch buttons
  const pitchButtons = document.querySelectorAll('#buzzer > button')
  try {
    for (let b of pitchButtons) {
      b.onclick = setSpiderPitch
    }
  }
  catch (e) {
    setError('Unable to set pitch button actions')
  }

  // activate other command buttons
  const cmdButtons = document.querySelectorAll('#cmdPanel > button')
  try {
    for (let b of cmdButtons) {
      b.onclick = sendButtonCommand
    }
  }
  catch (e) {
    setError('Unable to set command button actions')
  }
  // activate switches
  const cmdSwitches = document.querySelectorAll('#cmdPanel input[type=checkbox]')
  try {
    for( sw of cmdSwitches) {
      sw.onchange = onSwitchChange
    }
  }
  catch(ex) {
    setError('Unable to set switch actions')
  }

  try {
    sendCustomBtn.onclick = sendCustomCommand
  }
  catch(e) {
    console.log("Cannot activate custom command.")
  }
  connectBtn.onclick = connectPort
  sidetoneControl.onchange = onSidetoneChange
  wpmControl.onchange = e => {
    const wpm = parseInt(wpmControl.value)
    wpmLabel.innerHTML = wpmControl.value
    sendSpiderCommand([27, 3, wpm])
  }
});