package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

var dbPool *pgxpool.Pool

type ItemStruct struct {
	EAN         string   `json:"ean"`
	Text        string   `json:"text"`
	Subgroups   string   `json:"subgroups"`
	Classname   string   `json:"classname"`
	Count       int      `json:"count"`
	PerishDates []string `json:"perish_dates"`
	ImageURL    string   `json:"imageUrl"`
}

func handleSortOrder(sortOrder string) string {
	sortToQueryMap := map[string]string{
		"a-z":     "item_name ASC",
		"z-a":     "item_name DESC",
		"new-old": "(SELECT MAX(t) FROM jsonb_array_elements_text(timestamps) AS t) DESC",
		"old-new": "(SELECT MAX(t) FROM jsonb_array_elements_text(timestamps) AS t) ASC",
	}

	sortOrder = strings.ToLower(sortOrder)

	if query, exists := sortToQueryMap[sortOrder]; exists {
		return query
	}
	return sortToQueryMap["new-old"]
}

func buildFetchItemsQuery(subgroups string, classnames string, onlyWishList bool,
	sortOrder string, skip int, limit int) string {

	conditions := []string{}

	// Set conditions for the WHERE clause
	if subgroups != "" {
		conditions = append(conditions, fmt.Sprintf("subgroups = '%s'", subgroups))
	}
	if classnames != "" {
		conditions = append(conditions, fmt.Sprintf("classnames = '%s'", classnames))
	}
	if onlyWishList {
		conditions = append(conditions, "iswished = true")
	}

	// Construct WHERE clause
	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	// Construct ORDER BY clause
	orderByClause := fmt.Sprintf("ORDER BY %s", handleSortOrder(sortOrder))

	// Construct LIMIT clause
	limitClause := ""
	if limit > 0 {
		limitClause = fmt.Sprintf("LIMIT %d", limit)
	}

	// Construct OFFSET clause
	offsetClause := ""
	if skip > 0 {
		offsetClause = fmt.Sprintf("OFFSET %d", skip)
	}

	return fmt.Sprintf(`SELECT ean, item_name, subgroups, class, count, timestamps, image_url
		FROM item_list %s %s %s %s`, whereClause, orderByClause, offsetClause, limitClause)
}

func fetchItems(c *gin.Context) {
	subgroups := c.DefaultQuery("subgroups", "")
	classnames := c.DefaultQuery("classnames", "")
	onlyWishListStr := c.DefaultQuery("only_wish_list", "false")
	sortOrder := c.DefaultQuery("sortOrder", "new-old")
	skipStr := c.DefaultQuery("skip", "0")
	limitStr := c.DefaultQuery("limit", "0")

	// Parse parameters
	onlyWishList, err := strconv.ParseBool(onlyWishListStr)
	if err != nil {
		onlyWishList = false
	}

	skip, err := strconv.Atoi(skipStr)
	if err != nil {
		skip = 0
	}

	limit, err := strconv.Atoi(limitStr)
	if err != nil {
		limit = 0
	}

	// Build and execute query
	query := buildFetchItemsQuery(subgroups, classnames, onlyWishList, sortOrder, skip, limit)

	rows, err := dbPool.Query(context.Background(), query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("database error: %s", err.Error())})
		return
	}
	defer rows.Close()

	// Build items list
	var items []ItemStruct
	for rows.Next() {
		var item ItemStruct
		var timestamps []string
		var imageUrl sql.NullString

		err := rows.Scan(
			&item.EAN,
			&item.Text,
			&item.Subgroups,
			&item.Classname,
			&item.Count,
			&timestamps,
			&imageUrl,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("scan error: %s", err.Error())})
			return
		}
		if imageUrl.Valid {
			item.ImageURL = imageUrl.String
		} else {
			item.ImageURL = ""
		}

		// Set defaults for empty values
		if item.Subgroups == "" {
			item.Subgroups = ""
		}
		if item.Classname == "" {
			item.Classname = ""
		}
		if item.ImageURL == "" {
			item.ImageURL = "/none_available.png"
		}

		item.PerishDates = timestamps
		items = append(items, item)
	}

	if err = rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("rows error: %s", err.Error())})
		return
	}

	c.JSON(http.StatusOK, items)
}

func initDbPool(databaseUri string) (*pgxpool.Pool, error) {
	if databaseUri == "" {
		databaseUri = os.Getenv("DATABASE_URI")
	}

	pool, err := pgxpool.New(context.Background(), databaseUri)
	if err != nil {
		return nil, fmt.Errorf("unable to create connection pool: %w", err)
	}

	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		return nil, fmt.Errorf("unable to ping database: %w", err)
	}

	return pool, nil
}

func main() {
	var err error
	dbPool, err = initDbPool("postgresql://postgres:postgres@127.0.0.1:5432/maindb")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Database initialization failed: %v\n", err)
		os.Exit(1)
	}
	defer dbPool.Close()

	router := gin.Default()
	router.GET("/fetch_items", fetchItems)
	router.Run(":3031")
}
