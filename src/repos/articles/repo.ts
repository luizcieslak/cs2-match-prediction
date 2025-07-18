import * as fs from 'fs/promises'
import * as path from 'path'
import { Article } from './entity'
import { HLTVArticle, getTeamHeadlines } from './headlines'
import { fileExists, navigateTo, verboseLog } from '../../utils'
import { Locator } from 'patchright'
import { NewsAnalysis, newsAnalyst } from '../../tools'
import { CONFIG } from '../../config'

const WAIT_FOR = 'article.newsitem'
const ARTICLE_TITLE = 'h1.headline'
const ARTICLE_CONTENT = '.newstext-con p'

/**
 * A repository for retrieving Articles related to recent NFL events.
 */
export class ArticleRepo {
	// Cached list of articles
	private static articles: Article[] = []

	/**
	 * Get the list of articles associated with the given teams.
	 *
	 * @param teams The list of teams to filter by.
	 * @returns {Promise<Article[]>} The list of articles for the week associated with the given teams.
	 */
	public async findByTeams(teams: string[]): Promise<Article[]> {
		// check if there's already articles for these teams
		const i = ArticleRepo.articles.findIndex(article => teams.includes(article.primaryTeam))
		if (i !== -1) {
			return ArticleRepo.articles.filter(article => teams.includes(article.primaryTeam))
		}

		const articles = await this.fetchFromMatchTeams(teams)
		return articles.filter(article => teams.includes(article.primaryTeam))
	}

	/**
	 * Navigates to the page containing current headlines and for each headline
	 * navigates to the article page and scrapes the article.
	 *
	 * @returns {Promise<Article[]>} The list of articles for current headlines.
	 */
	private async fetchFromMatchTeams(teams: string[]): Promise<Article[]> {
		if (teams.length < 2) throw new Error('Not enough Teams in fetchFromMatchTeams')

		if (CONFIG.CACHE && !CONFIG.LOOK_FOR_NEW_ARTICLES) {
			const articlesPath = path.join(__filename, '../../../../', 'articles-cached/')

			// Read all files in the articles-cached directory
			const files = await fs.readdir(articlesPath)

			// Filter and process files for each team
			for (const team of teams) {
				const teamFiles = files.filter(file => file.startsWith(`${team}-`))

				for (const file of teamFiles) {
					const filePath = path.join(articlesPath, file)
					const fileContent = await fs.readFile(filePath, 'utf-8')
					const analysis = JSON.parse(fileContent) as NewsAnalysis

					// Extract article title from filename by removing team- prefix and .json suffix
					const articleTitle = file.slice(team.length + 1, -5)

					const article = new Article(articleTitle, analysis.summary, team)
					ArticleRepo.articles.push(article)
				}
			}

			verboseLog('returning cached articles for', teams)
			return ArticleRepo.articles
		}

		const team0List = await getTeamHeadlines(teams[0]!)
		const team1List = await getTeamHeadlines(teams[1]!)

		verboseLog(
			'articles list',
			JSON.stringify(
				[...team0List.map(article => article.title), ...team1List.map(article => article.title)],
				null,
				2
			)
		)

		// NOTE: We explicitly use a for-loop instead of `Promise.all` here because
		// we want to force sequential execution (instead of parallel) because these are
		// all sharing the same browser instance.
		for (const article of team0List) {
			try {
				const result = await this.fetchOne(article, teams[0]!)
				ArticleRepo.articles.push(result)
			} catch (e) {
				// Sometimes things timeout or a rogue headline sneaks in
				// that is actually an ad. We ignore it and move on.
				continue
			}
		}

		for (const article of team1List) {
			try {
				const result = await this.fetchOne(article, teams[1]!)
				ArticleRepo.articles.push(result)
			} catch (e) {
				// Sometimes things timeout or a rogue headline sneaks in
				// that is actually an ad. We ignore it and move on.
				continue
			}
		}

		return ArticleRepo.articles
	}

	/**
	 * Navigates to the given URL and scrapes the article.
	 *
	 * @param url The URL of the article to scrape.
	 * @returns {Promise<Article>} The article.
	 */
	private async fetchOne(article: HLTVArticle, team: string): Promise<Article> {
		if (!article.title) throw new Error('Article without an title.')

		if (CONFIG.CACHE) {
			const articlesPath = path.join(__filename, '../../../../', 'articles-cached/')
			const filename = `${team}-${article.title}.json`
			const filePath = path.join(articlesPath, filename)

			const summaryAlreadyDone = await fileExists(filePath)

			if (summaryAlreadyDone) {
				const file = await fs.readFile(filePath, 'utf-8')
				verboseLog('returning cached file for article', article.url.href)
				const analysis = JSON.parse(file) as NewsAnalysis
				return new Article(article.title, analysis.summary, team)
			}
		}

		const page = await navigateTo(article.url.toString(), WAIT_FOR)
		const title = await this.getTitle(page)
		const content = await this.getContent(page)
		const { summary } = await newsAnalyst(title, content, team)

		return new Article(title, summary, team)
	}

	/**
	 * Retrieves the title of the article.
	 *
	 * @param page The page to scrape.
	 * @returns {Promise<string>} The title of the article.
	 */
	private async getTitle(page: Locator): Promise<string> {
		const title = await page.locator(ARTICLE_TITLE).textContent()

		if (title == null || title.length == 0) {
			throw new Error(`Article title not found at ${page.page().url()}`)
		}

		return title
	}

	/**
	 * Retrieves the content of the article.
	 *
	 * @param page The page to scrape.
	 * @returns {Promise<string>} The content of the article.
	 */
	private async getContent(page: Locator): Promise<string> {
		const paragraphs = await page.locator(ARTICLE_CONTENT).all()
		const content = await Promise.all(paragraphs.map(p => p.textContent()))
		// perhaps we should get the table here?
		return content.join('\n\n')
	}
}
