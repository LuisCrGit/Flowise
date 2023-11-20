import { INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses } from '../../../src/utils'
import { VectorDBQAChain } from 'langchain/chains'
import { Document } from 'langchain/document'
import { VectaraStore } from 'langchain/vectorstores/vectara'
import fetch from 'node-fetch'

class VectaraChain_Chains implements INode {
    label: string
    name: string
    version: number
    type: string
    icon: string
    category: string
    baseClasses: string[]
    description: string
    inputs: INodeParams[]

    constructor() {
        this.label = 'Vectara QA Chain'
        this.name = 'vectaraQAChain'
        this.version = 1.0
        this.type = 'VectaraQAChain'
        this.icon = 'vectara.png'
        this.category = 'Chains'
        this.description = 'QA chain for Vectara'
        this.baseClasses = [this.type, ...getBaseClasses(VectorDBQAChain)]
        this.inputs = [
            {
                label: 'Vectara Vector Store',
                name: 'vectaraStore',
                type: 'VectorStore'
            }
        ]
    }

    async init(): Promise<any> {
        return null
    }

    async run(nodeData: INodeData, input: string): Promise<object> {
        const vectorStore = nodeData.inputs?.vectaraStore as VectaraStore
        const topK = (vectorStore as any)?.k ?? 4

        const headers = await vectorStore.getJsonHeader()
        const vectaraFilter = (vectorStore as any).vectaraFilter ?? {}
        const corpusId: number[] = (vectorStore as any).corpusId ?? []
        const customerId = (vectorStore as any).customerId ?? ''

        const corpusKeys = corpusId.map((corpusId) => ({
            customerId,
            corpusId,
            metadataFilter: vectaraFilter?.filter ?? '',
            lexicalInterpolationConfig: { lambda: vectaraFilter?.lambda ?? 0.025 }
        }))

        let summarizerPromptName = 'vectara-experimental-summary-ext-2023-10-23-med' // can let user select
        let responseLang = 'en' // can let user select
        let maxSummarizedResults = 5 // can let user specify

        const data = {
            query: [
                {
                    query: input,
                    start: 0,
                    numResults: topK,
                    contextConfig: {
                        sentencesAfter: vectaraFilter?.contextConfig?.sentencesAfter ?? 2,
                        sentencesBefore: vectaraFilter?.contextConfig?.sentencesBefore ?? 2
                    },
                    corpusKey: corpusKeys,
                    summary: [
                        {
                            summarizerPromptName,
                            responseLang,
                            maxSummarizedResults
                        }
                    ]
                }
            ]
        }

        try {
            const response = await fetch(`https://api.vectara.io/v1/query`, {
                method: 'POST',
                headers: headers?.headers,
                body: JSON.stringify(data)
            })

            if (response.status !== 200) {
                throw new Error(`Vectara API returned status code ${response.status}`)
            }

            const result = await response.json()
            const responses = result.responseSet[0].response
            const documents = result.responseSet[0].document
            let summarizedText = ''

            for (let i = 0; i < responses.length; i += 1) {
                const responseMetadata = responses[i].metadata
                const documentMetadata = documents[responses[i].documentIndex].metadata
                const combinedMetadata: Record<string, unknown> = {}

                responseMetadata.forEach((item: { name: string; value: unknown }) => {
                    combinedMetadata[item.name] = item.value
                })

                documentMetadata.forEach((item: { name: string; value: unknown }) => {
                    combinedMetadata[item.name] = item.value
                })

                responses[i].metadata = combinedMetadata
            }

            const summaryStatus = result.responseSet[0].summary[0].status
            if (summaryStatus.length > 0 && summaryStatus[0].code === 'BAD_REQUEST') {
                throw new Error(
                    `BAD REQUEST: Too much text for the summarizer to summarize. Please try reducing the number of search results to summarize, or the context of each result by adjusting the 'summary_num_sentences', and 'summary_num_results' parameters respectively.`
                )
            }

            if (
                summaryStatus.length > 0 &&
                summaryStatus[0].code === 'NOT_FOUND' &&
                summaryStatus[0].statusDetail === 'Failed to retrieve summarizer.'
            ) {
                throw new Error(`BAD REQUEST: summarizer ${summarizerPromptName} is invalid for this account.`)
            }

            summarizedText = result.responseSet[0].summary[0]?.text

            const sourceDocuments: Document[] = responses.map(
                (response: { text: string; metadata: Record<string, unknown>; score: number }) =>
                    new Document({
                        pageContent: response.text,
                        metadata: response.metadata
                    })
            )

            return { text: summarizedText, sourceDocuments: sourceDocuments }
        } catch (error) {
            throw new Error(error)
        }
    }
}

module.exports = { nodeClass: VectaraChain_Chains }