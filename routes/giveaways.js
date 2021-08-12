const ethers = require("ethers")

module.exports = function (fastify, opts, done) {
    async function getTokensByOwner(owner) {
        const balance = await fastify.contract.balanceOf(owner).then(res => res.toNumber())
        const tokens = await Promise.all(Array(balance).fill().map((_, index) => fastify.contract.tokenOfOwnerByIndex(owner, index).then(res => res.toNumber())))
        return tokens
    }

    fastify.get("/", async function (request, reply) {
        return await this.mongo.db.collection("giveaways").find({}, { _id: 0, entered: 0 }).toArray()
    })

    fastify.post("/", { schema: { body: {
        type: "object",
        required: ["giveaway", "signature"],
        properties: {
            giveaway: {
                type: "object",
                required: ["id", "description"],
                properties: {
                    id: { type: "number" },
                    description: { type: "string" },
                    amount_of_winners: { type: "number" }
                }
            },
            signature: { type: "string" }
        }
    } } }, async function (request, reply) {
        const giveaway = {
            ...request.body.giveaway,
            entered: 0,
            entries: [],
            created: Math.floor(new Date() / 1000),
            ends: Math.floor(new Date() / 1000) + (7 * 24 * 60 * 60)
        }

        const address = ethers.utils.verifyMessage(JSON.stringify(request.body.giveaway), request.body.signature)
        if (address != await this.contract.owner()) return { success: false, message: "You are not authorized to create new giveaways." }

        const result = await this.mongo.db.collection("giveaways").insertOne(giveaway)

        return { success: result.acknowledged }
    })

    // { message: "giveaway:1", signature: "0x0" }
    // { message: "giveaway:1", signature: "0x0" }
    fastify.post("/enter", {
        schema: { body: {
            type: "object",
            properties: {
                message: { type: "string" },
                signature: { type: "string" }
            }
        } },
        logLevel: "warn"
    }, async function (request, reply) {
        let address, giveawayId
        try {
            if (!request.body.message.includes("giveaway:")) return { success: false, message: "Invalid message." }

            address = ethers.utils.verifyMessage(request.body.message, request.body.signature)
            giveawayId = Number(request.body.message.split("giveaway:")[1])
            if (!giveawayId) return { success: false, message: "Invalid giveaway id." }
        } catch (error) {
            if (error.message.includes("signature")) return { success: false, message: "Invalid signature." }
            return { success: false, message: error.message }
        }

        const tokens = await getTokensByOwner(address) // [1,2,333]
        if (tokens.length == 0) return { success: false, message: "You have no tokens." }

        const giveaways = this.mongo.db.collection("giveaways")
        const [{ duplicates: tokensAlreadyEntered }] = await giveaways.aggregate([{
            $match: { id: giveawayId }
        }, {
            $project: {
                "duplicates" : {
                    $filter: {
                        input: "$entries",
                        as: "entry",
                        cond: { $in: [ "$$entry", tokens ] }
                    } 
                }
            }
        }]).toArray()

        const validEntries = tokens.filter(id => !tokensAlreadyEntered.includes(id))
        if (validEntries.length == 0) return { success: false, message: "All tokens have already entered." }
        
        const results = await giveaways.updateOne({
            id: giveawayId,
            ends: { $gt: Math.floor(new Date() / 1000) }
        }, {
            $inc: {
                entered: tokens.length
            },
            $push: {
                entries: { $each: tokens }
            }
        })

        if (results.modifiedCount != 1) return { success: false, message: "Giveaway not found or ended." }
        return { success: true }
    })

    fastify.post("/draw", async function (request, reply) {
        if (!request.body.message.includes("giveaway:")) return { success: false, message: "Invalid message." }
        const giveawayId = Number(request.body.message.split("giveaway:")[1])

        const address = ethers.utils.verifyMessage(request.body.message, request.body.signature)
        if (address != await this.contract.owner()) return { success: false, message: "You are not authorized to draw giveaways." }

        const giveaways = this.mongo.db.collection("giveaways")
        const giveaway = await giveaways.findOne({ id: giveawayId })
        if (!giveaway) return { success: false, message: "Giveaway not found." }
        if (giveaway.winners) return { success: false, message: "Giveaway already drawn." }

        let winners = []
        for (let i = giveaway.total_winners; i--;) {
            const tokenId = giveaway.entries[Math.floor(Math.random() * giveaway.entries.length)]
            const owner = await contract.ownerOf(tokenId)
            if (winners.includes(owner)) i++
            else winners.push(owner)
        }

        const results = await giveaways.updateOne({
            id: giveawayId
        }, {
            $set: { winners }
        })
        
        return { success: results.modifiedCount == 1 }
    })

    done()
}