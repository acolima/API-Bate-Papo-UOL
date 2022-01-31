import express, { json } from "express"
import { MongoClient, ObjectId } from "mongodb"
import dotenv from "dotenv"
import cors from "cors"
import joi from "joi"
import dayjs from "dayjs"
import { stripHtml } from "string-strip-html"

dotenv.config()

const server = express()
server.use(json())
server.use(cors())

async function connectToDB(){
  try {
    const mongoClient = new MongoClient(process.env.MONGO_URI)
    await mongoClient.connect()
    const db = mongoClient.db("BatePapo")
    
    return { mongoClient, db }
  } catch (error) {
    console.error(error)
  }
}

setInterval(async () => {
  const { mongoClient, db } = await connectToDB()
  const participantsCollection = db.collection("participants")
  const messagesCollection = db.collection("messages")

  const participants = await participantsCollection.find({}).toArray()

  for(const participant of participants)
    if(participant.lastStatus < (Date.now() - 10000)){
      await participantsCollection.deleteOne({_id: participant._id})
      await messagesCollection.insertOne({
        from: participant.name, 
        to: 'Todos', 
        text: 'sai da sala...',
        type: 'status',
        time: dayjs().format('HH:mm:ss')
      })
    }
  
  mongoClient.close()
}, 15000)

/* Schemes */
const participantSchema = joi.object({
  name: joi.string().required()
})

const messageSchema = joi.object({
  to: joi.string().required(),
  text: joi.string().required(),
  type: joi.string().regex(/message|private_message/).required(),
  from: joi.string().required(),
  time: joi.string().required()
})

/* Participants Routes */
server.post("/participants", async (req, res) => {
  const name = stripHtml(req.body.name).result.trim()
  const { mongoClient, db } = await connectToDB()
  const participantsCollection = db.collection("participants")
  const messagesCollection = db.collection("messages")
  const participants = await participantsCollection.find({}).toArray()
  
  const validation = participantSchema.validate({name})
  if(validation.error){
    res.sendStatus(422)
    mongoClient.close()
    return
  }
  
  const nameTaken = participants.find(participant => participant.name === name)
  if(!nameTaken){
    await participantsCollection.insertOne({name: name, lastStatus: Date.now()})
    await messagesCollection.insertOne({
      from: name, 
      to: 'Todos', 
      text: 'entra na sala...',
      type: 'status',
      time: dayjs().format('HH:mm:ss')
    })
      
    res.sendStatus(201)
    mongoClient.close()
  } 
  else res.sendStatus(409)
})

server.get("/participants", async (req, res) => {
  const { mongoClient, db } = await connectToDB()
  const participantsCollection = db.collection("participants")

  const participants = await participantsCollection.find({}).toArray()
    
  res.send(participants)
  mongoClient.close()
})

/* Messages Routes */
server.post("/messages", async (req, res) => {
  const name = stripHtml(req.headers.user).result
  const { mongoClient, db } = await connectToDB()
  const messagesCollection = db.collection("messages")
  const participantsCollection = db.collection("participants")

  const participant = await participantsCollection.findOne({name: name})
  
  const message = {
    to: stripHtml(req.body.to).result.trim(),
    type: stripHtml(req.body.type).result.trim(),
    text: stripHtml(req.body.text).result.trim(),
    from: name, 
    time: dayjs().format("HH:mm:ss")
  }
  
  const validation = messageSchema.validate(message)
  if(validation.error || !participant ){
    res.sendStatus(422)
    mongoClient.close()
    return
  }

  await messagesCollection.insertOne(message)
  
  res.sendStatus(201)
  mongoClient.close()
})

server.get("/messages", async (req, res) => {
  const limit = req.query.limit
  const name = req.headers.user
  const { mongoClient, db } = await connectToDB()
  const messagesCollection = db.collection("messages")
  
  const messages = await messagesCollection.find({$or: [{from: name}, {to: name}, {type: "message"}, {type: "status"}]}).toArray()

  if(limit){
    res.send(messages.slice(-limit))
    return
  }
  res.send(messages)
  mongoClient.close()
})

server.delete("/messages/:id", async (req, res) => {
  const name = req.headers.user
  const { id } = req.params
  const { mongoClient, db } = await connectToDB()
  const messagesCollection = db.collection("messages")
  const messages = await messagesCollection.findOne({_id: ObjectId(id)})

  if(!messages){
    res.sendStatus(404)
    mongoClient.close()
    return
  }
  
  if(messages.from !== name){
    res.sendStatus(401)
    mongoClient.close()
    return
  }

  await messagesCollection.deleteOne({_id: messages._id})
  mongoClient.close()
})

server.put("/messages/:id", async (req, res) => {
  const { mongoClient, db } = await connectToDB()
  const { id } = req.params
  const name = req.headers.user
  const participantsCollection = db.collection("participants")
  const messagesCollection = db.collection("messages")
  
  const participant = await participantsCollection.find({name: name}).toArray()
  
  const newMessage = {...req.body, from: name, time: dayjs().format("HH:mm:ss")}
  
  const validation = messageSchema.validate(newMessage)
  if(validation.error || !participant){
    res.sendStatus(422)
    mongoClient.close()
    return
  }

  const message = await messagesCollection.findOne({_id: new ObjectId(id)})
  if(!message){
    res.sendStatus(404)
    mongoClient.close()
    return
  }

  if(message.from !== req.headers.user){
    res.sendStatus(401)
    mongoClient.close()
    return
  }

  await messagesCollection.updateOne({_id: new ObjectId(id)}, {$set: {text: newMessage.text}})
  res.sendStatus(200)
  mongoClient.close()
})

/* Status Route */
server.post("/status", async (req, res) => {
  const name = stripHtml(req.headers.user).result.trim()
  const { mongoClient, db } = await connectToDB()
  const participantsCollection = db.collection("participants")

  const participant = await participantsCollection.findOne({name: name})

  if(!participant){
    res.sendStatus(404)
    mongoClient.close()
    return
  }

  const user = {name, lastStatus: Date.now()}
  await participantsCollection.updateOne({name: name}, {$set: user})
  res.sendStatus(200)
  mongoClient.close()
})

server.listen(5000, () => console.log("Listening on port 5000"))