const {app, BrowserWindow, ipcMain, webContents, ipcRenderer, dialog} = require("electron");
const {autoUpdater, AppUpdater} = require("electron-updater");

const url = require("url");
const path = require("path");
const fs = require("fs");

require('dotenv').config();
const supabase = require("./config/supabaseClient.js");

const {SerialPort} = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const { error, info, Console } = require("console");
const { sign } = require("crypto");
const parsers = SerialPort.parsers;
const parser = new ReadlineParser({ delimeter: "\r\n" });

const serialAbortController = new AbortController()
const updateAbortController = new AbortController()

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let fileName = 'test2.png'

let teensyCheckInterval = 2000
let showSerialError = false

let mainWindow;
let diaWindow;

function createWindow(title, width, height, fullscreen, index, preload){
    const newWindow = new BrowserWindow({
        title: title,
        width: width,
        height: height,
        fullscreen: fullscreen,
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

app.whenReady().then(()=>{
    mainWindow = createWindow("Collage Cuisine", 1000, 600, false, "../frontend/collage/index.html", "../frontend/collage/preload.js");
    diaWindow = createWindow("Diashow", 300, 500, false, "../frontend/diashow/dia.html", "../frontend/diashow/preload.js");
    autoUpdater.checkForUpdates();
    mainWindow.webContents.send("updateStatus", "checking for update")

    getSerialPort()
    getImageURL();
});

autoUpdater.on("update-available", (info) => {
    mainWindow.webContents.send("updateStatus", "update avaiable")
    if(process.platform == "win32"){
        autoUpdater.downloadUpdate();
    }else{
        dialog.showMessageBox(mainWindow, {title: "Update avaiable", type:"info", message:"There is a newer version of this software avaiable on the github repo. Due to your current operating system you have to download it manually."})
    }
})

autoUpdater.on("update-downloaded", (info)=>{
    mainWindow.webContents.send("updateStatus", "update downloaded")
    dialog.showMessageBox(mainWindow, {signal:updateAbortController.signal, type:"info", title:"Update installiert", message:"Software aktualisiert auf version: "+ app.getVersion()})
    setTimeout(()=>{
        updateAbortController.abort()
    },10000)
})

autoUpdater.on("error", (info)=>{
    mainWindow.webContents.send("updateStatus", info)
    dialog.showMessageBox(mainWindow, {signal:updateAbortController.signal, type:"error", title:"Update fehlgeschlagen", message:info})
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

async function getSerialPort(){
    let teensyPort
    await SerialPort.list().then((ports, err) => {
    if(err) {
      console.error(err)
    }

    if (ports.length === 0) {
      console.error("ERROR: No ports avaiable")
    }

    ports.forEach(port => {
        if(port.path.includes("usbmodem")||port.path.includes("COM")){
            teensyPort = port
        }
    });
    if(teensyPort == null){
        console.error("Teensy not connected, will try again")
        if(!showSerialError){
            dialog.showMessageBox(mainWindow,{signal:serialAbortController.signal, message:"Module nicht verbunden.", type:"warning", title:"FEHLER-006"})
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
            baudRate: 9600,
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
    serialAbortController.abort()
    showSerialError = false

    port.on('error', (err) => {
        console.error("unknown error")
    });

    port.on('close', (err) => {
        console.error("Teensy was dissconected, trying to reconnect");
        //bug dieses dialog fenster wird nicht gezeigt
        dialog.showMessageBox(mainWindow,{signal:serialAbortController.signal, message:"Module nicht verbunden.", type:"warning", title:"FEHLER-006"})
        teensyPort = null
        setTimeout(() => {
            getSerialPort()
        }, teensyCheckInterval)
    });
}

parser.on('data', function(data) {
    data = data.split(",")
    mainWindow.webContents.send("data", data)
});

ipcMain.handle("saveImage",()=>{
    console.log("saved image")
})

function saveImage(){
    mainWindow.webContents.capturePage().then((img)=>{
        fs.writeFile("./image.png", img.toPNG(), "base64", function(err){
            if(err) throw err;
            console.log("saved")
        })
    })
}

//Supabase

async function uploadCollage() {
    try {
        const storageFilePath = 'collages/' + fileName;
        const collageFileBuffer = fs.readFileSync('backend/screenshots/' + fileName);
        const { data, error } = await supabase
        .storage
        .from('Collages')
        .upload(storageFilePath, collageFileBuffer, {
            cacheControl: '3600',
            upsert: false
        })
        if (error) {
            console.error("Error uploading file:", error);
        } else {
            console.log("File data:", data);
        }
    } catch (error) {
        console.error("An unexpected error occurred while uploading screenshot:", error);
    }
}

async function getImageURL() {
    try {
        const storageFilePath = 'collages/' + fileName;
        const { data , error } = supabase
        .storage
        .from('Collages')
        .getPublicUrl(storageFilePath)
        if (error) {
            console.error("Error fetching ImageURL:", error);
        } else {
            console.log("ImageURL:", data);
        }
    } catch (error) {
        console.error("An unexpected error occurred while fetching ImageURL:", err);
    }
}