// Require the framework and instantiate it
require("dotenv").config()
const fastify = require("fastify")({ logger: true })
const ethers = require("ethers")
const abi = require("./abi")

const provider = new ethers.providers.JsonRpcProvider(process.env.JSON_RPC_URI)
const contract = new ethers.Contract(process.env.CONTRACT, abi, provider)
fastify.decorate("provider", provider)
fastify.decorate("contract", contract)
contract.owner().then(console.log)

fastify.register(require("fastify-mongodb"), {
  forceClose: true,
  url: process.env.MONGODB_URI
})

// Declare a route
fastify.register(require("./routes/giveaways"), { prefix: "/giveaways" })
fastify.register(require("./routes/proposals"), { prefix: "/proposals" })

// Run the server!
const start = async () => {
  try {
    await fastify.listen(3000)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}
start()