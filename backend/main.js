/*----------------------------------------------------
This file is the first script that gets run
when the app is launched and acts as the apps backend
----------------------------------------------------*/

//-----Electron-----//
const {app, BrowserWindow, ipcMain, webContents, ipcRenderer, dialog} = require("electron");
const {autoUpdater, AppUpdater} = require("electron-updater");

//-----System/OS-----//
const os = require("os");
const url = require("url");
const path = require("path");
const fs = require("fs");

//-----Supabase-----//
require('dotenv').config();
const supabase = require("./config/supabaseClient.js");

//-----Serialport-----//
const {SerialPort} = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const { error, info, Console } = require("console");
const { sign } = require("crypto");
const { title } = require("process");
const { truncate } = require("node:original-fs");
const parsers = SerialPort.parsers;
const parser = new ReadlineParser({ delimeter: "\r\n" });

//-----Error messages-----//
let serialAbortController = new AbortController()
const updateAbortController = new AbortController()
let diaWindowAbortController = new AbortController()
let savePathAbortController = new AbortController()
const teensyNotConnected = {
    signal: serialAbortController.signal,
    type: "warning",
    title: "Module nicht mit Computer verbunden",
    message: "FEHLER-01: Module nicht mit Computer verbunden.",
    detail: "Bitte informieren Sie eine Museumsaufsicht."
}

const diaWindowError = {
    signal: diaWindowAbortController.signal,
    type: "error",
    title: "Kein Zugriff zu online Bilder",
    message: "FEHLER-02: Kein Zugriff zu online Bilder Datenbank",
    detail: "Stellen Sie sicher, dass der Computer mit dem Internet verbunden ist. " + error.message
}

const uploadError = {
    signal: updateAbortController.signal,
    type:"warning",
    title:"Bild konnte nicht hochgeladen werden",
    message: "FEHLER-03: Bild konnte nicht hochgeladen werden",
    detail: "Stellen Sie sicher, dass der Computer mit dem Internet verbunden ist."
}

const savePathError = {
    signal: savePathAbortController.signal,
    type: "error",
    title:"Kein Ordner Collagen auf Desktop",
    message: "FEHLER-04: Kein Ordner 'Collagen' auf Desktop gefunden",
    detail:"Bitte erstellen Sie einen Ordner mit dem Namen 'Collagen' auf dem Desktop"
}

//-----Autoupdate-----//
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

//-----variables-----//
let teensyCheckInterval = 2000
let showSerialError = false

let waitForSafe = false
let savePath

let mainWindow;
let diaWindow;

let filename;
let newFilename;
let nameCounter = Math.floor(Math.random() * 41);

/* Returns a new Window with specified input parameters */
function createWindow(title, width, height, x, y, fullscreen, index, preload){
    const newWindow = new BrowserWindow({
        title: title,
        width: width,
        height: height,
        x: x,
        y: y,
        fullscreen: fullscreen,
        autoHideMenuBar: true,
        webPreferences:{
            contextIsolation: true,
            nodeIntegration: true,
            preload: path.join(__dirname, preload)
        }
    });

    const startUrl = url.format({
        pathname: path.join(__dirname, index),
        protocol: "file"
    });

    newWindow.loadURL(startUrl);

    return newWindow;
}

//-----App entry point-----//

/*Is called when the programm starts – Entry point to the app*/
app.whenReady().then(()=>{
    mainWindow = createWindow("Collage Cuisine", 1000, 600, -2000, 50, true, "../frontend/collage/index.html", "../frontend/preload.js");
    diaWindow = createWindow("Diashow", 300, 500, 100, 50, true, "../frontend/diashow/dia.html", "../frontend/preload.js");

    startUpdateCheck()

    /*process.platform is the current os, darwin -> MacOs, win32 -> all windows OS also 64bit */
    if(process.platform == "darwin"){
        savePath = os.homedir()+"/Desktop/Collagen/"
    }
    if(process.platform == "win32"){
        savePath = os.homedir()+"\\Desktop\\Collagen\\"
    }

    /*sends the current home path to the preload script*/
    ipcMain.handle('osFilePath', () => getRandomImageURL());

    /*starts serial config*/
    getSerialPort()
});


//-----Autoupdate-----//

/*Autoinstall update on windows, and inform about new update on macOS */
autoUpdater.on("update-available", (info) => {
    mainWindow.webContents.send("updateStatus", "update avaiable")
    if(process.platform == "win32"){
        autoUpdater.downloadUpdate();
    }else{
        dialog.showMessageBox(mainWindow, {title: "Update verfügbar", type:"info", message:"Update verfügbar", detail:"Es ist eine neue Version von 'Collage Cuisine' verfügbar. Aufgrund Ihres momentanen Betriebsystems muss diese manuell von GitHub heruntergeladen und installiert werden."})
        setTimeout(()=>{
            updateAbortController.abort()
        },10000)
    }
})

/**Update downloaded message*/
autoUpdater.on("update-downloaded", (info)=>{
    mainWindow.webContents.send("updateStatus", "update downloaded")
    dialog.showMessageBox(mainWindow, {signal:updateAbortController.signal, type:"info", title:"Update installiert", message:"Update installiert", detail:"Software aktualisiert von Version: "+ app.getVersion() + "auf nächste"})
    setTimeout(()=>{
        updateAbortController.abort()
    },10000)
})

/*Download Error*/
autoUpdater.on("error", (info)=>{
    mainWindow.webContents.send("updateStatus", info)
    dialog.showMessageBox(mainWindow, {signal:updateAbortController.signal, type:"error", title:"Update fehlgeschlagen", message:info.message})
    setTimeout(()=>{
        updateAbortController.abort()
    },10000)
})


// app.on('activate', function () {
//     if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
//   })
// app.on('window-all-closed', function () {
//   if (process.platform !== 'darwin') app.quit()
// })


//-----Serialport-----//

async function getSerialPort(){
    await SerialPort.list().then((ports, err) => {
    if(err) {
      console.error(err)
    }

    const teensyPort = ports.find(port =>
  port.vendorId && port.productId &&
  port.vendorId.toLowerCase() === '16c0' &&
  port.productId.toLowerCase() === '0483'
);


    if (ports.length === 0) {
      console.error("ERROR: No ports avaiable")
    }

    if(teensyPort == null){
        console.error("Teensy not connected, will try again")
        if(!showSerialError){
            dialog.showMessageBox(mainWindow, teensyNotConnected)
            showSerialError = true;
        }
    }
    openPort(teensyPort)
  })
}

function openPort(teensyPort){
    let port
    try{
        port = new SerialPort({
            path: teensyPort.path,
            baudRate: 115200,
            dataBits: 8,
            parity: "none",
            stopBits: 1,
            flowControl: false,
        });
    }catch(err){
        setTimeout(() => {
            getSerialPort()
        }, teensyCheckInterval)
        return;
    }
    port.pipe(parser);
    console.log("connected to teensy on port", teensyPort.path)
    if(showSerialError){
        serialAbortController.abort()
        serialAbortController = new AbortController()
        teensyNotConnected.signal = serialAbortController.signal
        showSerialError = false
    }

    port.on('error', (err) => {
        console.error(err)
    });

    port.on('close', (err) => {
        console.error("Teensy was dissconected, trying to reconnect");
        //bug dieses dialog fenster wird nicht gezeigt
        dialog.showMessageBox(mainWindow, teensyNotConnected)
        showSerialError = true
        teensyPort = null
        setTimeout(() => {
            getSerialPort()
        }, teensyCheckInterval)
    });
}

/*Gets called when port recieves data from the teensy*/
parser.on('data', function(data) {
    data = data.split(",")
    mainWindow.webContents.send("data", data)
});


//-----Save image-----//

ipcMain.handle("saveImage",()=>{
    saveImage()
})

let saving = false;

async function saveImage(){

    if(saving) {
        console.log("Already saving");
        return;
    }

    saving = true;

    try {

        const date = new Date();

        const filename =
            "Collage-" +
            date.getFullYear() +
            "-" +
            date.getMonth() +
            "-" +
            date.getDate() +
            "-" +
            date.getHours() +
            "-" +
            date.getMinutes() +
            "-" +
            date.getSeconds();

        const newFilename = "Collage-" + nameCounter;

        if(nameCounter < 50){
            nameCounter++;
        } else {
            nameCounter = 0;
        }

        const img = await mainWindow.webContents.capturePage();

        await fs.promises.writeFile(
            savePath + filename + ".png",
            img.toPNG()
        );

        await uploadCollage(filename, newFilename);

    } catch(err) {

        console.error(err);

    } finally {

        saving = false;
    }
}

ipcMain.handle('fileNames', () => getFileNames()); //if upload succcessful update list for diashow

//get image names
function getFileNames() {
    return fs.readdirSync(savePath);
}


//-----Supabase-----//

//uploads file to Supabase
async function uploadCollage(filename, newFilename) {

    try {

        const storageFilePath =
            'collages/' + newFilename + ".png";

        const collageFileBuffer =
            fs.readFileSync(savePath + filename + ".png");

        await supabase
            .storage
            .from('Collages')
            .remove([storageFilePath])
            .catch(console.log);

        const { error } = await supabase
            .storage
            .from('Collages')
            .upload(storageFilePath, collageFileBuffer, {
                cacheControl: '3600',
                upsert: true
            });

        if (error) {
            console.error(error);
            dialog.showMessageBox(mainWindow, uploadError);
            return;
        }

        const imageURL =
            await getImageURL(newFilename);

        mainWindow.webContents.send(
            "qrLink",
            imageURL
        );

    } catch(error) {

        console.error(error);
    }
}

// returns URL from img on Supabase
async function getImageURL(newFilename) {

    try {

        const storageFilePath =
            'collages/' + newFilename + ".png";

        const { data, error } =
            supabase
            .storage
            .from('Collages')
            .getPublicUrl(storageFilePath);

        if(error) {
            console.error(error);
            return null;
        }

        return data.publicUrl;

    } catch(error) {

        console.error(error);
        return null;
    }
}

ipcMain.handle('getDiaPath', getRandomImageURL)

async function getRandomImageURL() {
    try {
        const storageFilePath = 'collages/' + 'Collage-' + Math.floor(Math.random() * 51) + ".png";
        const { data , error } = supabase
        .storage
        .from('Collages')
        .getPublicUrl(storageFilePath)
        if (error) {
            console.error("Error fetching RandomImageURL:", error);
            dialog.showMessageBox(diaWindow, diaWindowError)
        } else {
            const imageURL = data.publicUrl;
            console.log("RandomImageURL:", imageURL);
            return imageURL;
        }
    } catch (error) {
        console.error("An unexpected error occurred while fetching ImageURL:", error);
        dialog.showMessageBox(diaWindow, diaWindowError)
    }
}

//gets version number
ipcMain.handle('get-app-version', () => {
    return app.getVersion();  // this gets version from package.json
});

//update check function
async function startUpdateCheck() {
  const online = await waitForInternet()

  if (!online) {
    console.log('Kein Internet -> Update Check übersprungen')
    return
  }

  try {
    await autoUpdater.checkForUpdates()
    mainWindow.webContents.send("updateStatus", "checking for update")
  } catch (err) {
    console.error('Update Fehler:', err)
  }
}

//Internet check
async function waitForInternet(maxAttempts = 10) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await dns.lookup('api.github.com')

      console.log('Internet verfügbar')
      return true
    } catch (err) {
      console.log(`DNS noch nicht verfügbar (${attempt}/${maxAttempts})`)

      // Exponential Backoff
      const delay = Math.min(attempt * 2000, 15000)

      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  return false
}