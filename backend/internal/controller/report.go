package controller

import (
	"net/http"
	"strconv"
	"strings"

	"Project-M/internal/repository"
	"Project-M/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ReportController struct {
	reportSvc *service.ReportService
}

func ProvideReportController(db *gorm.DB) *ReportController {
	return &ReportController{
		reportSvc: service.ProvideReportService(repository.NewReportRepository(db)),
	}
}

func (ctrl *ReportController) ManagerReport(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "view_reports", "missing view_reports permission")
	if !ok {
		return
	}
	var (
		report *service.ManagerReportResponse
		err    error
	)
	from, to := strings.TrimSpace(c.Query("from")), strings.TrimSpace(c.Query("to"))
	if from != "" || to != "" {
		if to == "" {
			to = from
		}
		if from == "" {
			from = to
		}
		start, end, rangeErr := service.ParseManagerReportRange(from, to, repository.BangkokNow())
		if rangeErr != nil {
			respondAPIError(c, http.StatusBadRequest, rangeErr)
			return
		}
		report, err = ctrl.reportSvc.ManagerReportRange(restaurantID, start, end)
	} else {
		report, err = ctrl.reportSvc.ManagerReport(restaurantID, boundedQueryInt(c, "days", 14, 1, 90))
	}
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, report)
}

func (ctrl *ReportController) SalesByHour(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "view_reports", "missing view_reports permission")
	if !ok {
		return
	}
	date := c.Query("date")
	if date == "" {
		date = repository.BangkokNow().Format("2006-01-02")
	}
	report, err := ctrl.reportSvc.SalesByHour(restaurantID, date)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, report)
}

// barQuery reads the date + optional hour that identify a clicked chart bar.
// No `hour` means a whole-day bar; -1 is the sentinel the service expects.
func barQuery(c *gin.Context) (string, int, bool) {
	date := c.Query("date")
	if date == "" {
		date = repository.BangkokNow().Format("2006-01-02")
	}
	hour := -1
	if raw := c.Query("hour"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 || parsed > 23 {
			respondInvalidRequest(c)
			return "", 0, false
		}
		hour = parsed
	}
	return date, hour, true
}

func (ctrl *ReportController) SalesDetail(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "view_reports", "missing view_reports permission")
	if !ok {
		return
	}
	date, hour, ok := barQuery(c)
	if !ok {
		return
	}
	report, err := ctrl.reportSvc.SalesDetail(restaurantID, date, hour)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, report)
}

func (ctrl *ReportController) ExpenseDetail(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "view_reports", "missing view_reports permission")
	if !ok {
		return
	}
	date, hour, ok := barQuery(c)
	if !ok {
		return
	}
	report, err := ctrl.reportSvc.ExpenseDetail(restaurantID, date, hour)
	if err != nil {
		respondAPIError(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, report)
}

func (ctrl *ReportController) TopMenuItemsByMonth(c *gin.Context) {
	restaurantID, ok := requireRestaurantWithPermission(c, "view_reports", "missing view_reports permission")
	if !ok {
		return
	}
	now := repository.BangkokNow()
	year := boundedQueryInt(c, "year", now.Year(), 2000, 2100)
	month := boundedQueryInt(c, "month", int(now.Month()), 1, 12)

	report, err := ctrl.reportSvc.TopMenuItemsByMonth(restaurantID, year, month)
	if err != nil {
		respondAPIError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, report)
}
