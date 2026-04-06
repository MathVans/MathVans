import axios from 'axios'
import { CONFIG, GITHUB_ACCESS_TOKEN } from './constants.js'
import { consoleObject } from './utils.js'
import { fetchGitHubGraphql } from './apis.js'

// https://docs.github.com/en/graphql/reference/objects#sponsorsactivity
// https://docs.github.com/en/graphql/reference/enums#sponsorsactivityaction
const SPONSOR_NODE_QUERY = `
  ... on User {
    login
    name
    url
    avatarUrl
    websiteUrl
  }
  ... on Organization {
    login
    name
    url
    avatarUrl
    websiteUrl
  }
`

const QUERY = `
  query {
    user(login: "${CONFIG.GITHUB_UID}") {
      repositories(
        first: 100
        isFork: false
        ownerAffiliations: OWNER
        orderBy: {field: CREATED_AT, direction: DESC}
      ) {
        nodes {
          name
          languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
            edges {
              size
              node {
                name
                color
              }
            }
          }
        }
      }
      sponsorsActivities(first:100, period: ALL, orderBy: { direction: DESC, field: TIMESTAMP }, actions: [NEW_SPONSORSHIP, CANCELLED_SPONSORSHIP]) {
        nodes {
          action,
          sponsorsTier {
            isOneTime
          },
          sponsor {
            ${SPONSOR_NODE_QUERY}
          }
        }
      },
      sponsors(first: 100) {
        totalCount
        edges {
          node {
            ${SPONSOR_NODE_QUERY}
          }
        }
      }
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              weekday
              date
              contributionCount
              color
            }
          }
        }
      }
    }
  }
`

const LANGUAGE_COLOR_MAP = {
  Batchfile: '#C1F12E',
  C: '#555555',
  'C#': '#178600',
  'C++': '#f34b7d',
  CMake: '#DA3434',
  CSS: '#563d7c',
  Dockerfile: '#384d54',
  Go: '#00ADD8',
  HTML: '#e34c26',
  HLSL: '#aace60',
  Java: '#b07219',
  JavaScript: '#f1e05a',
  'Jupyter Notebook': '#DA5B0B',
  Lua: '#000080',
  Mako: '#7e858d',
  ObjectiveC: '#438eff',
  'Objective-C': '#438eff',
  'Objective-C++': '#6866fb',
  PHP: '#4F5D95',
  PLpgSQL: '#336790',
  Python: '#3572A5',
  Ruby: '#701516',
  Rust: '#dea584',
  SCSS: '#c6538c',
  ShaderLab: '#222c37',
  Shell: '#89e051',
  SQL: '#e38c00',
  Svelte: '#ff3e00',
  Swift: '#ffac45',
  TSQL: '#e38c00',
  TypeScript: '#3178c6',
  Vue: '#41b883'
}

const DEFAULT_LANGUAGE_COLOR = '#8b949e'

const buildLanguagesFromRepositories = async (repositories = []) => {
  const languages = []
  let totalSize = 0
  const languageStats = {}

  const ownedRepositories = repositories.filter(
    (repository) => !repository.fork && repository.owner?.login === CONFIG.GITHUB_UID
  )

  await Promise.all(
    ownedRepositories.map(async (repository) => {
      if (!repository.languages_url) return

      const response = await axios.get(repository.languages_url)
      const repoLanguages = response.data || {}

      for (const [langName, langSize] of Object.entries(repoLanguages)) {
        totalSize += langSize

        if (languageStats[langName]) {
          languageStats[langName].size += langSize
        } else {
          languageStats[langName] = {
            size: langSize,
            color: LANGUAGE_COLOR_MAP[langName] || DEFAULT_LANGUAGE_COLOR
          }
        }
      }
    })
  )

  for (const lang in languageStats) {
    const item = languageStats[lang]
    item.percentage = totalSize > 0 ? Number((item.size / totalSize) * 100).toFixed(2) : '0.00'
    languages.push({ name: lang, ...item })
  }

  languages.sort((a, b) => b.size - a.size)

  return languages
}

const EMPTY_CONTRIBUTIONS = {
  totalContributions: 0,
  weeks: []
}

const EMPTY_SPONSORS = {
  totalCount: 0,
  currentSponsors: [],
  pastSponsors: []
}

export const getGitHubPrivateData = async (repositories = []) => {
  if (!GITHUB_ACCESS_TOKEN) {
    const languages = await buildLanguagesFromRepositories(repositories)

    console.group(`[GitHub Private]`)
    console.log('GITHUB_ACCESS_TOKEN not found, using public repository language data only')
    console.log('total languages:', languages.length)
    console.groupEnd()

    return {
      contributions: EMPTY_CONTRIBUTIONS,
      languages,
      sponsors: EMPTY_SPONSORS
    }
  }

  const graphqlPrivateData = await fetchGitHubGraphql(QUERY, GITHUB_ACCESS_TOKEN)
  console.group(`[GitHub Private]`)

  // ---------------------------------------------------------------
  // contributions (default: last year)
  const contributions = graphqlPrivateData.contributionsCollection.contributionCalendar
  console.log('last year totalContributions:', contributions.totalContributions)

  // ---------------------------------------------------------------
  // languages statistics
  const languages = []
  let totalSize = 0
  const languageStats = {}
  graphqlPrivateData.repositories.nodes.forEach((repo) => {
    repo.languages.edges.forEach((edge) => {
      const langSize = edge.size
      const langName = edge.node.name
      const langColor = edge.node.color || LANGUAGE_COLOR_MAP[langName] || DEFAULT_LANGUAGE_COLOR
      totalSize += langSize
      if (languageStats[langName]) {
        languageStats[langName].size += langSize
      } else {
        languageStats[langName] = {
          size: langSize,
          color: langColor
        }
      }
    })
  })

  for (const lang in languageStats) {
    const item = languageStats[lang]
    item.percentage = Number((item.size / totalSize) * 100).toFixed(2)
    languages.push({ name: lang, ...item })
  }

  // sort languages by size
  languages.sort((a, b) => b.size - a.size)
  console.log('total languages:', languages.length)

  // ---------------------------------------------------------------
  // sponsors
  const currentSponsors = graphqlPrivateData.sponsors.edges.map((edge) => edge.node) || []
  const currentSponsorsLogins = currentSponsors.map((item) => item.login)

  const pastSponsors = []
  const addedPastLogins = new Set()
  // 1. order by TIMESTAMP/DESC
  // 2. filter out current sponsors
  // 3. the latest user to cancel is at the head of the array
  // 4. no cancellation events for one-time sponsor
  graphqlPrivateData.sponsorsActivities.nodes.forEach((node) => {
    // Recently, GitHub returned the Ghost user as null
    if (node && node.sponsor.login !== 'ghost') {
      if (node.action === 'CANCELLED_SPONSORSHIP' || node.sponsorsTier.isOneTime) {
        if (!currentSponsorsLogins.includes(node.sponsor.login)) {
          if (!addedPastLogins.has(node.sponsor.login)) {
            pastSponsors.push(node.sponsor)
            addedPastLogins.add(node.sponsor.login)
          }
        }
      }
    }
  })

  consoleObject('sponsors:', {
    totalCount: graphqlPrivateData.sponsors.totalCount,
    currentSponsors: currentSponsors.length,
    pastSponsors: pastSponsors.length
  })

  console.groupEnd()

  return {
    contributions,
    languages,
    sponsors: {
      totalCount: graphqlPrivateData.sponsors.totalCount,
      currentSponsors,
      pastSponsors
    }
  }
}
