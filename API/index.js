const puppeteer = require('puppeteer');
const fs = require("fs");
const envInputRaw = fs.readFileSync("env.json");
const envInput = JSON.parse(envInputRaw);
var browser;

var express = require('express');
var app = express();

//data
var activitiesDataBase = {};
var mostRecentActivityId = 0;
var ticketNotesCache = {};

app.get('/getActivity', async function (req, res) {
	try {
		console.log("Route getActivity called");
		await updateDataBase();
		res.send( activitiesDataBase );
	} catch(error) {
		console.log("Route getActivity error", error);
		res.error("some problem");
	}
	
 });

 var server = app.listen(8081, function () {
	var host = server.address().address;
	var port = server.address().port;
	console.log("SATS API app listening at http://%s:%s", host, port);
 });

/*
----Start----
{
  iconType: 'comment',
  text: ' Matthew Cleary added a note to Ticket #22275 at 11:42:30 AM',
  action: 'added',
  dateTime: '04/24/20 11:42:30 AM',
  parts: [
    {
      text: 'Matthew Cleary',
      link: 'https://support.sa.sc.edu/admin/users/32/edit',
      type: 'users'
    },
    {
      text: 'Ticket #22275',
      link: 'https://support.sa.sc.edu/admin/tickets/22275/edit',
      type: 'tickets',
      ticketNumber: '22275',
      note: [Object]
    }
  ]
}
{
  text: "Found a Logitech C270 at Amazon. Usually $40, not $140. I'm not buying at that price.",
  private: true,
  user: 'Matthew Cleary',
  dateTime: '04/24/20 11:42:30 AM'
}
----END----
*/
 
async function updateDataBase(){
	console.log("Start browser");
	browser = await puppeteer.launch({headless: false}); //{headless: false, slowMo: 250}
	
	await connectAndLogin();

	let allActivity = await getActivites();

 	allActivity.forEach(async(item)=>{
		// console.log("----Start----");
		let dateTimeMilliSeconds = new Date (item.dateTimeString).getTime();
		// console.log("dateTimeMilliSeconds", dateTimeMilliSeconds);
		item['dateTimeMilliSeconds'] = dateTimeMilliSeconds;
		if(mostRecentActivityId < item.id) mostRecentActivityId = item.id;
		if(activitiesDataBase[item.id] == null){
			// console.log("Item Text:", item.text);
			// console.log("Item Action:", item.action);
			if(item.action == 'added'){
				// console.log("New \'added\' item", dateTimeMilliSeconds);
				// item.parts.forEach(async (part)=>{
				// 	if(part.type == 'tickets'){
				// 		try {
				// 			let allNotesFromTicket = await getNotesFromTicket(part.ticketNumber);
				// 			allNotesFromTicket.forEach((note)=>{
				// 				// console.log(item.dateTimeString, '<==>', note.dateTimeString);
				// 				if(item.dateTimeString == note.dateTimeString){
				// 					part.note = note;
				// 				}
				// 			});
				// 			// console.log(part.notes);
				// 		} catch(error) {
				// 			console.log("error getting notes from ticket", part.ticketNumber, error);
				// 		}
				// 	}
				// }); //each part of item
				// console.log(item);
				// item.parts.forEach((part)=>{
				// 	if(part.note) console.log(part.note);
				// });
				activitiesDataBase[item.id] = item;
			} //if item is 'added'
			else { //TODO handle other types of items
			}
			
		} else {
			// console.log("Already Processesed this \'added\' item", dateTimeMilliSeconds);
		}
		 //TODO handle other types like submitted or assigned or closed
		// console.log("----END----");
 	}); //each activity item
 	
 	console.log("finished script");
 	
	await browser.close();
};

async function connectAndLogin(){
	let page = await browser.newPage();
	// await page.setViewport({width: 1920, height: 1080});
	await page.goto('https://support.sa.sc.edu');
	// await page.screenshot({path: 'example.png'});
	console.log("Navigate to Support SATS");

  	// Login
	await page.type('#user_session_login', envInput.login);
	await page.type('#user_session_password', envInput.pass);
	await page.click('input[value="Login"]');
	page.close();
	console.log("Logged in");
	// await page.waitForNavigation();
}

async function getActivites(){
	let page = await browser.newPage();
	//go to activities page and get list
	await page.goto('https://support.sa.sc.edu/activities');
	// await page.waitForNavigation();
	console.log("Go to activities page");
	return await page.evaluate(() => {
        let activities = [];
        //get all direct children of element with class "container main"
        let everythingInMain = document.querySelectorAll('.container.main > *');
        // console.log(everythingInMain);
        let date = "N/A";
        everythingInMain.forEach((item)=>{
        	// console.log(item.tagName);
        	if(item.tagName == 'H3'){
        		// console.log("H3 tag:",item.innerText);
        		date = item.innerText;
        	} else if(item.classList.contains('activity')){
        		let activityJson = {};
	            console.log(item);
	            try {
	            	let iconName = item.querySelector('i').className;
					let iconType = iconName.split(' ')[1].split('-')[1];
					let activityId = item.id.split('_')[1];
					// console.log('iconType: ', iconType);
					activityJson.id = activityId;
					activityJson.ticketNumber = "N/A";
	            	activityJson.iconType = iconType;
	            	activityJson.text = item.innerText;
	            	activityJson.action = activityJson.text.split(' ')[3];
	            	activityJson.dateTimeString = date +' '+ activityJson.text.split(' at ')[1];
	            	let partsElms = item.querySelectorAll('a');
	            	activityJson.parts = [];
	            	partsElms.forEach((part)=>{
	            		let partObj = {};
	            		partObj.text = part.innerText;
	            		partObj.link = part.href;
	            		partObj.type = part.href.split('/')[4];
	            		if(partObj.type == 'tickets'){
							 partObj.ticketNumber = part.href.split('/')[5];
							 activityJson.ticketNumber = partObj.ticketNumber;
						}
	            		activityJson.parts.push(partObj);

	            	});
	            }
	            catch (exception){

	            }
	            activities.push(activityJson);
        	}
        });
        return activities;
    });
}

//open page referenced, get ticket comments
async function getNotesFromTicket(ticketNumber){
	let ticketNotes;
	if(ticketNotesCache[ticketNumber] != null){
		ticketNotes = ticketNotesCache[ticketNumber];
	} else {
		// console.log("open new tab for ticket: ", ticketNumber);
		let tab = await browser.newPage();
		await tab.goto('https://support.sa.sc.edu/admin/tickets/'+ticketNumber+'/edit');
		ticketNotes = await tab.evaluate(() => {
			let notes = [];
			let notesDiv = document.querySelector('#notes');
			console.log(notesDiv);
			let eachNoteDiv = notesDiv.querySelectorAll('div .media-body');
			// console.log(eachNoteDivs);
			eachNoteDiv.forEach((noteDiv)=>{
				let tempNote = {};
				console.log(noteDiv);
				tempNote.text = noteDiv.querySelector('p').innerText;
				let headingText = noteDiv.querySelector('.media-heading').innerText.split('\n')[0];
				headingTextSplit = headingText.split(' ');
				console.log("headingTextSplit: ",headingTextSplit);
				if(headingTextSplit[1] == 'PRIVATE'){
					tempNote.private = true;
					tempNote.user = headingTextSplit[2] +' '+ headingTextSplit[3];
				}
				else{
					tempNote.private = false;
					tempNote.user = headingText;
				}
				
				tempNote.dateTimeString = noteDiv.querySelector('.pull-right').innerText;
				notes.push(tempNote);
			});
			ticketNotesCache[ticketNumber] = notes;
			return notes;
		});
		tab.close();
	}
	
	return ticketNotes;
}