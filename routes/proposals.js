const ethers = require("ethers")

module.exports = function (fastify, opts, done) {
    async function getTokensByOwner(owner) {
        const balance = await fastify.contract.balanceOf(owner).then(res => res.toNumber())
        const tokens = await Promise.all(Array(balance).fill().map((_, index) => fastify.contract.tokenOfOwnerByIndex(owner, index).then(res => res.toNumber())))
        return tokens
    }

    fastify.get("/", async function (request, reply) {
        return await this.mongo.db.collection("proposals").find({}, { _id: 0, voted: 0 }).toArray()
    })

    fastify.post("/", { schema: { body: {
        type: "object",
        required: ["proposal", "signature"],
        properties: {
            proposal: {
                type: "object",
                required: ["id", "description"],
                properties: {
                    id: { type: "number" },
                    description: { type: "string" }
                }
            },
            signature: { type: "string" }
        }
    } } }, async function (request, reply) {
        const proposal = {
            ...request.body.proposal,
            votes: 0,
            up: 0,
            down: 0,
            voted: [],
            created: Math.floor(new Date() / 1000),
            ends: Math.floor(new Date() / 1000) + (7 * 24 * 60 * 60)
        }

        const address = ethers.utils.verifyMessage(JSON.stringify(request.body.proposal), request.body.signature)
        if (address != await this.contract.owner()) return { success: false, message: "You are not authorized to create new proposals." }

        const result = await this.mongo.db.collection("proposals").insertOne(proposal)

        return { success: result.nInserted == 1 }
    })

    // { message: "1;proposal:1", signature: "0x0" }
    // { message: "0;proposal:1", signature: "0x0" }
    fastify.post("/vote", {
        schema: { body: {
            type: "object",
            properties: {
                message: { type: "string" },
                signature: { type: "string" }
            }
        } },
        logLevel: "warn"
    }, async function (request, reply) {
        let address, vote, proposalId
        try {
            if (!request.body.message.includes("proposal:")) return { success: false, message: "Invalid message." }

            address = ethers.utils.verifyMessage(request.body.message, request.body.signature)
            const [ up, proposal ] = request.body.message.split(";")

            if (!["1", "0"].includes(up)) return { success: false, message: "You must either vote up or down." }
            proposalId = Number(proposal.split("proposal:")[1])
            if (!proposalId) return { success: false, message: "Invalid proposal id." }

            vote = up == "1" ? "up" : "down"
        } catch (error) {
            if (error.message.includes("signature")) return { success: false, message: "Invalid signature." }
            return { success: false, message: error.message }
        }

        const tokens = await getTokensByOwner(address) // [1,2,333]
        if (tokens.length == 0) return { success: false, message: "You have no tokens." }

        const proposals = this.mongo.db.collection("proposals")
        const [{ duplicates: tokensAlreadyVoted }] = await proposals.aggregate([{
            $match: { id: proposalId }
        }, {
            $project: {
                "duplicates" : {
                    $filter: {
                        input: "$voted",
                        as: "vote",
                        cond: { $in: [ "$$vote", tokens ] }
                    } 
                }
            }
        }]).toArray()

        const validVotes = tokens.filter(id => !tokensAlreadyVoted.includes(id))
        if (validVotes.length == 0) return { success: false, message: "All tokens have already voted." }
        
        const results = await proposals.updateOne({
            id: proposalId,
            ends: { $gt: Math.floor(new Date() / 1000) }
        }, {
            $inc: {
                votes: tokens.length,
                [vote]: tokens.length
            },
            $push: {
                voted: { $each: tokens }
            }
        })
        
        if (results.modifiedCount != 1) return { success: false, message: "Proposal not found or ended." }
        return { success: true }
    })

    done()
}