import { URL } from 'url'
import { navigateTo, verboseLog } from '../../utils'
import { Locator } from 'patchright'

export interface HLTVArticle {
	url: URL
	title: string | undefined
}

const BASE_URL_SEARCH = 'https://www.hltv.org/search'
const SELECTOR_SEARCH = 'td a[href^="/team"]'
const WAIT_FOR_SEARCH = '.contentCol'

async function getTeamPage(team: string): Promise<string | null> {
	const locator = await navigateTo(`${BASE_URL_SEARCH}?query=${team}`, WAIT_FOR_SEARCH)
	const headlines = await locator.locator(SELECTOR_SEARCH).all()
	const teamLinks = await Promise.all(
		headlines.map(async headline => ({
			href: await headline.getAttribute('href'),
			name: await headline.innerText(),
		}))
	)
	const matchingTeam = teamLinks.find(t => t.name.toLowerCase() === team.toLowerCase())
	if (!matchingTeam?.href) return null

	return matchingTeam.href
}

const SELECTOR_MEMBERS = '.bodyshot-team a[href^="/player"]'
const SELECTOR_COACH = '.profile-team-stat a[href^="/coach"] .a-default'

async function getTeamMembers(locator: Locator): Promise<(string | null)[]> {
	const membersAnchorLink = await locator.locator(SELECTOR_MEMBERS).all()
	const members = await Promise.all(membersAnchorLink.map(async a => a.getAttribute('title')))

	try {
		const coach = await locator.locator(SELECTOR_COACH).textContent()
		if (coach) members.push(coach.replace("'", ''))
	} catch (error) {}

	return members
}

const BASE_URL = 'https://www.hltv.org'
const SELECTOR = 'a.subTab-newsArticle'
const WAIT_FOR = '.contentCol'

/**
 * Crawls the search page for HLTV news for a team in specific and grabs the URLs for each headline.
 */
export async function getTeamHeadlines(team: string, limit = 10): Promise<HLTVArticle[]> {
	verboseLog('Fetching HLTV headlines for team', team)
	const teamPage = await getTeamPage(team)
	const locator = await navigateTo(`${BASE_URL}${teamPage}#tab-newsBox`, WAIT_FOR)
	const members = await getTeamMembers(locator)

	// limit should be applied in the end, not in the beginning
	const headlines = await locator.locator(`${SELECTOR}:nth-child(-n+${limit * 6})`).all()

	const anchors = await Promise.all(
		headlines.map(async headline => ({
			title: (await headline.innerText()).split('\n')[1],
			href: await headline.getAttribute('href'),
		}))
	)

	const result = anchors.filter(anchor => {
		if (!anchor.href) return
		if (!anchor.title) return

		// articles without relevant content
		if (anchor.href.includes('former-00nation')) return
		if (anchor.href.includes('invited')) return
		if (anchor.href.includes('fantasy')) return
		if (anchor.href.includes('announced')) return
		if (anchor.href.endsWith('revealed')) return
		if (anchor.href.includes('schedule')) return
		if (anchor.href.includes('team-list')) return
		if (anchor.href.includes('live-updates')) return
		if (anchor.href.includes('short')) return
		// general guides
		if (anchor.href.endsWith('guide')) return
		// unrelated to the major
		if (anchor.href.includes('bestia')) return

		return (
			anchor.title.includes(team) ||
			members.some(member => typeof member === 'string' && anchor.title?.includes(member))
		)
	})

	return result
		.map(anchor => ({ url: new URL(anchor.href || '', BASE_URL_SEARCH), title: anchor.title }))
		.slice(0, limit)
}
